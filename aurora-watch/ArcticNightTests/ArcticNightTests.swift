import XCTest
@testable import ArcticNight

final class ArcticNightTests: XCTestCase {
    private func date(_ s: String) -> Date { ISO8601DateFormatter().date(from: s)! }

    func testSunAltitudeMatchesTheWebAppsMath() {
        // Reference values from docs/arctic.js
        XCTAssertEqual(LiveCheck.sunAltitude(date("2027-01-30T21:30:00Z"), lat: 69.648, lon: 18.955), -36.2873, accuracy: 0.001)
        XCTAssertEqual(LiveCheck.sunAltitude(date("2027-02-09T12:00:00Z"), lat: 56.018, lon: -3.437), 18.9308, accuracy: 0.001)
        XCTAssertEqual(LiveCheck.sunAltitude(date("2026-11-02T03:00:00Z"), lat: 32.22, lon: -110.97), -31.2805, accuracy: 0.001)
    }

    func testShipPositionFromWaypoints() {
        let t0 = date("2027-01-31T22:00:00Z").timeIntervalSince1970 * 1000
        let t1 = date("2027-02-01T11:00:00Z").timeIntervalSince1970 * 1000
        let w = [LiveCheck.Waypoint(t: t0, lat: 69.648, lon: 18.955), LiveCheck.Waypoint(t: t1, lat: 69.968, lon: 23.272)]
        let mid = LiveCheck.position(at: Date(timeIntervalSince1970: (t0 + t1) / 2000), waypoints: w)!
        XCTAssertEqual(mid.lat, (69.648 + 69.968) / 2, accuracy: 1e-6)
        XCTAssertNil(LiveCheck.position(at: date("2027-03-01T00:00:00Z"), waypoints: w))
    }

    func testOvationChanceNearAPlace() throws {
        var coords: [[Double]] = []
        for lon in 0..<360 { for lat in -90...90 { coords.append([Double(lon), Double(lat), (66...71).contains(lat) ? 55 : 0]) } }
        let data = try JSONSerialization.data(withJSONObject: ["Forecast Time": "2027-01-30T21:40:00Z", "coordinates": coords])
        XCTAssertEqual(LiveCheck.ovationChance(data, lat: 69.65, lon: 18.96), 55)
        XCTAssertEqual(LiveCheck.ovationChance(data, lat: 32.2, lon: -110.9), 0)
        XCTAssertEqual(LiveCheck.ovationChance(data, lat: 69.0, lon: -0.5), 55, "wraps around 0° longitude")
    }

    func testLiveConfigRoundTrip() throws {
        let json = #"{"enabled":true,"minProb":30,"waypoints":[{"t":1,"lat":2,"lon":3}],"here":{"lat":32.2,"lon":-110.9},"ovationURL":"https://example.com/x.json"}"#
        let cfg = try JSONDecoder().decode(LiveCheck.Config.self, from: Data(json.utf8))
        LiveCheck.save(cfg)
        XCTAssertEqual(LiveCheck.loadConfig()?.waypoints.count, 1)
        XCTAssertEqual(LiveCheck.loadConfig()?.here?.lat, 32.2)
    }

    func testWebFilesAreInTheApp() {
        let dir = Bundle.main.url(forResource: "docs", withExtension: nil)
        XCTAssertNotNil(dir)
        for f in ["index.html", "app.js", "arctic.js", "style.css"] {
            XCTAssertTrue(FileManager.default.fileExists(atPath: dir!.appendingPathComponent(f).path), f)
        }
    }
}
