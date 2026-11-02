import XCTest
@testable import FjordSpotter

final class FjordSpotterTests: XCTestCase {
    func testScreensAndLandmarkDataAreInsideTheApp() throws {
        let dir = try XCTUnwrap(Bundle.main.url(forResource: "fjord-spotter", withExtension: nil))
        for f in ["index.html", "app.js", "fjord.js", "style.css", "data/route.js", "data/landmarks.js"] {
            XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent(f).path), f)
        }
        let data = try String(contentsOf: dir.appendingPathComponent("data/landmarks.js"), encoding: .utf8)
        XCTAssertTrue(data.hasPrefix("window.FJORD_LANDMARKS="))
        XCTAssertGreaterThan(data.count, 10_000, "landmark file has real content")
    }
}
