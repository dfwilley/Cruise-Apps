import XCTest
@testable import HourBetween

final class HourBetweenTests: XCTestCase {
    let root = Bundle.main.resourceURL!.standardizedFileURL

    func testScreensAndPortDataAreInsideTheApp() throws {
        for f in ["hour-between/index.html", "hour-between/app.js", "hour-between/planner.js", "hour-between/style.css",
                  "port-guide/data/ports.js", "port-guide/data/places.js"] {
            XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(f).path), f)
        }
    }

    func testSchemeHandlerServesBundleFilesOnly() {
        XCTAssertNotNil(BundleSchemeHandler.file(for: URL(string: "hb://localhost/hour-between/index.html")!, in: root))
        XCTAssertNil(BundleSchemeHandler.file(for: URL(string: "hb://localhost/../../etc/hosts")!, in: root), "cannot escape the bundle")
        XCTAssertEqual(BundleSchemeHandler.file(for: URL(string: "hb://localhost/hour-between/")!, in: root)?.lastPathComponent, "index.html")
    }

    func testOnlyThePlannerStaysInsideTheApp() {
        XCTAssertNil(PlannerController.outsideURL(for: URL(string: "hb://localhost/hour-between/index.html")!))
        XCTAssertEqual(PlannerController.outsideURL(for: URL(string: "hb://localhost/port-guide/")!)?.absoluteString,
                       "https://dfwilley.github.io/Cruise-Apps/port-guide/")
        XCTAssertEqual(PlannerController.outsideURL(for: URL(string: "https://www.openstreetmap.org/")!)?.host, "www.openstreetmap.org")
    }
}
