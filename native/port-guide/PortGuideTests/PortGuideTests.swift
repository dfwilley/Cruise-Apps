import XCTest
@testable import PortGuide

final class PortGuideTests: XCTestCase {
    func testScreensAndPortDataAreInsideTheApp() throws {
        let dir = try XCTUnwrap(Bundle.main.url(forResource: "port-guide", withExtension: nil))
        for f in ["index.html", "app.js", "port.js", "style.css", "data/ports.js", "data/places.js"] {
            XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent(f).path), f)
        }
        let facts = try String(contentsOf: dir.appendingPathComponent("data/ports.js"), encoding: .utf8)
        XCTAssertTrue(facts.hasPrefix("window.PORT_FACTS="))
        for port in ["Tromsø", "Alta", "Harstad", "Narvik", "Bergen", "Rosyth", "Tilbury"] { XCTAssertTrue(facts.contains(port), port) }
        let places = try String(contentsOf: dir.appendingPathComponent("data/places.js"), encoding: .utf8)
        XCTAssertGreaterThan(places.count, 5_000, "sights file has real content")
    }
}
