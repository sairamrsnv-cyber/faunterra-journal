//! A local stand-in that speaks eBird's response shape.
//!
//! WHY THIS EXISTS
//! The pull path is the part of this system that must not be wrong, and it is
//! also the part you cannot exercise freely: every test run against the real
//! API spends quota on an account that can be suspended for abuse. So this
//! serves the same routes, the same auth check and the same JSON shape over a
//! real socket. The puller is not modified, mocked or stubbed — only the base
//! URL changes. Everything downstream (parse, sanitise, atomic write, rollup)
//! runs exactly as it does in production.
//!
//! WHAT IT IS NOT
//! It is not eBird, and its rows are not observations. Whether the real
//! endpoint returns every record or collapses to one row per species is a
//! question only the live API can answer — run `pull --probe` once against it.
//! Every row this serves is marked synthetic in the archive file itself.
//!
//! The species table is drawn from eBird's taxonomy for the Indian
//! subcontinent so the output reads plausibly. Codes are best-effort; the
//! fixture's job is shape, not taxonomy.

use std::io::{BufRead, BufReader, Write};
use std::net::{TcpListener, TcpStream};

const SPECIES: &[(&str, &str, &str)] = &[
    ("houcro1", "House Crow", "Corvus splendens"),
    ("commyn", "Common Myna", "Acridotheres tristis"),
    ("rocpig", "Rock Pigeon", "Columba livia"),
    ("rewbul", "Red-vented Bulbul", "Pycnonotus cafer"),
    ("blakit1", "Black Kite", "Milvus migrans"),
    ("asikoe2", "Asian Koel", "Eudynamys scolopaceus"),
    ("pursun4", "Purple Sunbird", "Cinnyris asiaticus"),
    ("indrob1", "Indian Robin", "Copsychus fulicatus"),
    ("litegr", "Little Egret", "Egretta garzetta"),
    ("whtkin2", "White-throated Kingfisher", "Halcyon smyrnensis"),
    ("rinpar", "Rose-ringed Parakeet", "Psittacula krameri"),
    ("comtai1", "Common Tailorbird", "Orthotomus sutorius"),
    ("blwlap1", "Red-wattled Lapwing", "Vanellus indicus"),
    ("asipie1", "Oriental Magpie-Robin", "Copsychus saularis"),
    ("grehor1", "Indian Grey Hornbill", "Ocyceros birostris"),
];

const LOCATIONS: &[(&str, f64, f64)] = &[
    ("Okhla Bird Sanctuary", 28.5535, 77.3100),
    ("Ranganathittu Bird Sanctuary", 12.4200, 76.6600),
    ("Bharatpur--Keoladeo NP", 27.1600, 77.5200),
    ("Thattekad Bird Sanctuary", 10.1200, 76.6900),
    ("Sultanpur National Park", 28.4600, 76.8900),
    ("Chilika Lake--Mangalajodi", 20.0500, 85.4400),
];

/// Deterministic pseudo-randomness. Same date in, same rows out — so a run is
/// reproducible and a diff between two runs means something changed in the
/// code, not in the dice.
struct Lcg(u64);
impl Lcg {
    fn next(&mut self) -> u64 {
        self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        self.0 >> 33
    }
    fn below(&mut self, n: usize) -> usize {
        (self.next() % n as u64) as usize
    }
}

fn seed_from(s: &str) -> u64 {
    // FNV-1a. Cheap, stable, and good enough to turn a date string into a seed.
    let mut h: u64 = 0xcbf29ce484222325;
    for b in s.bytes() {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h | 1
}

fn observations(region: &str, y: &str, m: &str, d: &str) -> String {
    let date = format!("{y}-{:0>2}-{:0>2}", m, d);
    let mut rng = Lcg(seed_from(&format!("{region}{date}")));

    // 140–260 records a day. Enough that byte counts, throttling and the
    // species rollup all behave like the real thing.
    let count = 140 + rng.below(120);
    let mut rows: Vec<String> = Vec::with_capacity(count);

    for _ in 0..count {
        let (code, com, sci) = SPECIES[rng.below(SPECIES.len())];
        let (loc, lat, lng) = LOCATIONS[rng.below(LOCATIONS.len())];
        let how_many = 1 + rng.below(12);
        let hour = 5 + rng.below(13);
        let minute = rng.below(60);
        let valid = rng.below(100) > 4;
        let reviewed = rng.below(100) > 80;
        let jitter = (rng.below(2000) as f64 - 1000.0) / 100_000.0;

        rows.push(format!(
            r#"{{"speciesCode":"{code}","comName":"{com}","sciName":"{sci}","locId":"L{locid}","locName":"{loc}","obsDt":"{date} {hour:02}:{minute:02}","howMany":{how_many},"lat":{lat:.5},"lng":{lng:.5},"obsValid":{valid},"obsReviewed":{reviewed},"obsId":"OBS{obsid}","subId":"S{subid}","userDisplayName":"Fixture Observer"}}"#,
            locid = 1_000_000 + seed_from(loc) % 8_999_999,
            lat = lat + jitter,
            lng = lng + jitter,
            obsid = 100_000_000 + rng.next() % 899_999_999,
            subid = 100_000_000 + rng.next() % 899_999_999,
        ));
    }

    format!("[{}]", rows.join(","))
}

fn respond(stream: &mut TcpStream, status: u16, reason: &str, body: &str) {
    let _ = write!(
        stream,
        "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.flush();
}

fn handle(mut stream: TcpStream) {
    let peer = stream.try_clone().expect("clone stream");
    let mut reader = BufReader::new(peer);

    let mut request_line = String::new();
    if reader.read_line(&mut request_line).is_err() {
        return;
    }
    let path = request_line.split_whitespace().nth(1).unwrap_or("/").to_string();

    let mut token = String::new();
    loop {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => {
                if line.trim().is_empty() {
                    break;
                }
                if let Some(v) = line.to_ascii_lowercase().strip_prefix("x-ebirdapitoken:") {
                    token = v.trim().to_string();
                }
            }
            Err(_) => break,
        }
    }

    // Mirror the real failure the puller must survive: a missing or obviously
    // wrong key is a 403, not an empty list.
    if token.len() < 6 {
        eprintln!("  fixture  403  {path}  (token missing or too short)");
        respond(&mut stream, 403, "Forbidden", r#"{"errors":[{"status":"403"}]}"#);
        return;
    }

    let parts: Vec<&str> = path.split('?').next().unwrap_or("").split('/').filter(|p| !p.is_empty()).collect();
    // /v2/data/obs/{region}/historic/{y}/{m}/{d}
    if parts.len() == 8 && parts[1] == "data" && parts[2] == "obs" && parts[4] == "historic" {
        let body = observations(parts[3], parts[5], parts[6], parts[7]);
        eprintln!("  fixture  200  {}  ({} bytes)", parts[3..].join("/"), body.len());
        respond(&mut stream, 200, "OK", &body);
        return;
    }

    eprintln!("  fixture  404  {path}");
    respond(&mut stream, 404, "Not Found", r#"{"errors":[{"status":"404"}]}"#);
}

fn main() {
    let port: u16 = std::env::args()
        .nth(1)
        .and_then(|p| p.parse().ok())
        .unwrap_or(8788);

    // Loopback only. This serves generated data with no authentication worth
    // the name; it has no business being reachable from the network.
    let listener = TcpListener::bind(("127.0.0.1", port)).expect("bind loopback");
    eprintln!("  eBird fixture listening on http://127.0.0.1:{port}/v2  (synthetic data)");

    for stream in listener.incoming().flatten() {
        handle(stream);
    }
}
