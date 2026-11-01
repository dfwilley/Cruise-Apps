import Foundation

/// The background "look now" check, done natively so it can run while the app is closed.
/// Mirrors arctic.js: sun altitude, ship position from waypoints, and NOAA's live aurora map near a place.
enum LiveCheck {
    struct Waypoint: Codable { let t: Double; let lat: Double; let lon: Double }
    struct Here: Codable { let lat: Double; let lon: Double }
    struct Config: Codable {
        var enabled: Bool = true
        var minProb: Double = 30
        var waypoints: [Waypoint] = []
        var here: Here? = nil
        var ovationURL: String = "https://services.swpc.noaa.gov/json/ovation_aurora_latest.json"
    }

    static let configKey = "arctic.live.config"
    static let lastAlertKey = "arctic.live.lastAlert"

    static func loadConfig() -> Config? {
        guard let d = UserDefaults.standard.data(forKey: configKey) else { return nil }
        return try? JSONDecoder().decode(Config.self, from: d)
    }
    static func save(_ c: Config) {
        if let d = try? JSONEncoder().encode(c) { UserDefaults.standard.set(d, forKey: configKey) }
    }

    // MARK: Sun altitude (same low-precision formulas as arctic.js)
    static func sunAltitude(_ date: Date, lat: Double, lon: Double) -> Double {
        let rad = Double.pi / 180, e = rad * 23.4397
        let d = date.timeIntervalSince1970 * 1000 / 86_400_000 - 0.5 + 2_440_588 - 2_451_545
        let M = rad * (357.5291 + 0.98560028 * d)
        let C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M))
        let L = M + C + rad * 102.9372 + Double.pi
        let dec = asin(sin(0) * cos(e) + cos(0) * sin(e) * sin(L))
        let ra = atan2(sin(L) * cos(e) - tan(0) * sin(e), cos(L))
        let H = rad * (280.16 + 360.9856235 * d) - (-lon * rad) - ra
        let phi = lat * rad
        return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H)) / rad
    }

    /// Ship position from arrive/depart waypoints (ms since 1970); nil outside the voyage.
    static func position(at date: Date, waypoints: [Waypoint]) -> (lat: Double, lon: Double)? {
        let t = date.timeIntervalSince1970 * 1000
        guard let first = waypoints.first, let last = waypoints.last, t >= first.t, t <= last.t else { return nil }
        for i in 0..<(waypoints.count - 1) {
            let a = waypoints[i], b = waypoints[i + 1]
            if t >= a.t && t <= b.t {
                let f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
                return (a.lat + (b.lat - a.lat) * f, a.lon + (b.lon - a.lon) * f)
            }
        }
        return nil
    }

    /// Highest aurora chance (0–100) within about 3° of a place, from NOAA's OVATION JSON.
    static func ovationChance(_ data: Data, lat: Double, lon: Double) -> Double? {
        guard let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let coords = obj["coordinates"] as? [[Double]] else { return nil }
        let L = Int(lat.rounded()), G = Int(((lon.truncatingRemainder(dividingBy: 360)) + 360).truncatingRemainder(dividingBy: 360).rounded())
        var best = 0.0
        for c in coords where c.count >= 3 {
            let cl = Int(c[1].rounded()), cg = Int(c[0].rounded())
            guard abs(cl - L) <= 3 else { continue }
            var dg = abs(cg - G) % 360; if dg > 180 { dg = 360 - dg }
            if dg <= 4 && c[2] > best { best = c[2] }
        }
        return best
    }

    /// Runs one check. Returns the chance found (or nil when skipped).
    @discardableResult
    static func run(now: Date = Date()) async -> Double? {
        guard let cfg = loadConfig(), cfg.enabled else { return nil }
        let pos: (lat: Double, lon: Double)
        if let p = position(at: now, waypoints: cfg.waypoints) { pos = p }
        else if let h = cfg.here { pos = (h.lat, h.lon) }
        else { return nil }
        guard sunAltitude(now, lat: pos.lat, lon: pos.lon) < -10 else { return nil }
        guard let url = URL(string: cfg.ovationURL),
              let (data, _) = try? await URLSession.shared.data(from: url),
              let chance = ovationChance(data, lat: pos.lat, lon: pos.lon) else { return nil }
        let last = UserDefaults.standard.double(forKey: lastAlertKey)
        if chance >= cfg.minProb && now.timeIntervalSince1970 - last > 2 * 3600 {
            UserDefaults.standard.set(now.timeIntervalSince1970, forKey: lastAlertKey)
            await Notifier.post(id: "live-\(Int(now.timeIntervalSince1970))",
                                title: "Aurora likely now — go look north",
                                body: "NOAA's live map shows about \(Int(chance))% chance of aurora near the ship. Check the sky (clouds permitting).",
                                after: 1)
        }
        return chance
    }
}
