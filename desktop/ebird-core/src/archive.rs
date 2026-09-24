//! The archive: one JSON file per region per day.
//!
//! WHY DATE-PARTITIONED FILES AND NOT A DATABASE
//! The eBird API serves a rolling ~30-day window. Anything older is gone — not
//! expensive, *gone*, short of requesting the eBird Basic Dataset. So the value
//! of this archive is entirely in its continuity, and the failure mode that
//! matters is a silent hole. Flat files make holes visible: `ls` is the audit.
//! A day either exists or it does not; there is no partially-written row, no
//! migration that can lose a month, no lock to lose.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::model::DayFile;

/// Directories that are mount points rather than ordinary folders. If the
/// archive lives under one of these, we verify the volume is genuinely mounted
/// before writing a single byte.
const MOUNT_ROOTS: &[&str] = &["/Volumes", "/media", "/mnt", "/run/media"];

#[derive(Debug)]
pub struct Location {
    pub dir: PathBuf,
    /// True when the path sits on an external volume we verified is mounted.
    pub guarded: bool,
}

#[derive(Debug)]
pub enum ArchiveError {
    NotMounted { volume: String },
    Io(String),
}

impl std::fmt::Display for ArchiveError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ArchiveError::NotMounted { volume } => write!(
                f,
                "\"{volume}\" is a folder on the system disk, not a mounted volume. \
                 Refusing to write — plug the drive in, or point the archive somewhere else."
            ),
            ArchiveError::Io(e) => write!(f, "{e}"),
        }
    }
}

/// Resolve where the archive lives, refusing the one failure that is genuinely
/// expensive.
///
/// THE HAZARD THIS EXISTS FOR
/// Unplug an external drive on macOS and `/Volumes/LaCie` does not vanish —
/// the next process to write there simply *creates* it, as an ordinary folder
/// on the boot disk. Days of pulls then fill internal storage while every log
/// line says "wrote to /Volumes/LaCie/…" and looks perfectly healthy. You find
/// out when the Mac runs out of disk.
///
/// A real mount sits on a different device than its parent. Same device means
/// the drive is not there. We stop, loudly, rather than write.
pub fn resolve(raw: Option<&str>, fallback: &Path) -> Result<Location, ArchiveError> {
    let Some(raw) = raw.map(str::trim).filter(|s| !s.is_empty()) else {
        return Ok(Location {
            dir: fallback.to_path_buf(),
            guarded: false,
        });
    };
    let dir = PathBuf::from(raw);

    let Some(root) = MOUNT_ROOTS.iter().find(|r| dir.starts_with(r)) else {
        return Ok(Location {
            dir,
            guarded: false,
        });
    };

    // The volume is the first component below the mount root: /Volumes/LaCie
    let volume: PathBuf = dir
        .components()
        .take(PathBuf::from(root).components().count() + 1)
        .collect();

    let vol_meta = fs::metadata(&volume).map_err(|_| ArchiveError::NotMounted {
        volume: volume.display().to_string(),
    })?;
    let root_meta = fs::metadata("/").map_err(|e| ArchiveError::Io(e.to_string()))?;

    if same_device(&vol_meta, &root_meta) {
        return Err(ArchiveError::NotMounted {
            volume: volume.display().to_string(),
        });
    }

    Ok(Location { dir, guarded: true })
}

#[cfg(unix)]
fn same_device(a: &fs::Metadata, b: &fs::Metadata) -> bool {
    use std::os::unix::fs::MetadataExt;
    a.dev() == b.dev()
}

#[cfg(not(unix))]
fn same_device(_a: &fs::Metadata, _b: &fs::Metadata) -> bool {
    // No st_dev equivalent worth trusting here; the guard is a no-op rather
    // than a false promise.
    false
}

pub fn day_path(dir: &Path, region: &str, date: &str) -> PathBuf {
    dir.join(region).join(format!("{date}.json"))
}

pub fn has_day(dir: &Path, region: &str, date: &str) -> bool {
    day_path(dir, region, date).is_file()
}

/// Write one day, atomically.
///
/// Atomic because the skip-if-present rule above turns a half-written file into
/// a permanent hole: the next run sees a file, skips the day, and the truncated
/// record stays forever. tmp + rename means a day is either absent or complete.
pub fn write_day(dir: &Path, day: &DayFile) -> Result<(PathBuf, usize), ArchiveError> {
    let region_dir = dir.join(&day.region);
    fs::create_dir_all(&region_dir).map_err(|e| ArchiveError::Io(e.to_string()))?;

    let final_path = day_path(dir, &day.region, &day.date);
    let tmp_path = final_path.with_extension("json.tmp");

    let encoded = serde_json::to_vec(day).map_err(|e| ArchiveError::Io(e.to_string()))?;
    fs::write(&tmp_path, &encoded).map_err(|e| ArchiveError::Io(e.to_string()))?;
    fs::rename(&tmp_path, &final_path).map_err(|e| ArchiveError::Io(e.to_string()))?;

    Ok((final_path, encoded.len()))
}

/// What is on disk right now, newest first. Reads filenames only — an archive
/// of 30 large days should not cost 400 MB of RAM to summarise.
pub fn index(dir: &Path) -> io::Result<Vec<(String, Vec<String>)>> {
    let mut out: Vec<(String, Vec<String>)> = Vec::new();
    if !dir.is_dir() {
        return Ok(out);
    }
    for entry in fs::read_dir(dir)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let region = entry.file_name().to_string_lossy().to_string();
        let mut days: Vec<String> = fs::read_dir(entry.path())?
            .filter_map(Result::ok)
            .filter_map(|f| {
                let name = f.file_name().to_string_lossy().to_string();
                name.strip_suffix(".json").map(str::to_string)
            })
            .collect();
        days.sort_unstable_by(|a, b| b.cmp(a));
        out.push((region, days));
    }
    out.sort_unstable_by(|a, b| a.0.cmp(&b.0));
    Ok(out)
}

pub fn read_day(dir: &Path, region: &str, date: &str) -> io::Result<DayFile> {
    let raw = fs::read(day_path(dir, region, date))?;
    serde_json::from_slice(&raw).map_err(|e| io::Error::new(io::ErrorKind::InvalidData, e))
}
