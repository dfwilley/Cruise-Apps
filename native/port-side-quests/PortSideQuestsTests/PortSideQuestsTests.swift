import XCTest
@testable import PortSideQuests

final class PortSideQuestsTests: XCTestCase {
    let root = Bundle.main.resourceURL!.standardizedFileURL

    func testScreensAndPortDataAreInsideTheApp() throws {
        for f in ["port-side-quests/index.html", "port-side-quests/app.js", "port-side-quests/quests.js", "port-side-quests/store.js",
                  "port-side-quests/sync.js", "port-side-quests/vendor/supabase.js", "port-guide/data/ports.js",
                  "port-guide/data/places.js", "hour-between/planner.js"] {
            XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(f).path), f)
        }
    }

    func testSchemeHandlerServesBundleFilesOnly() {
        let ok = BundleSchemeHandler.file(for: URL(string: "psq://localhost/port-side-quests/index.html")!, in: root)
        XCTAssertNotNil(ok)
        XCTAssertNil(BundleSchemeHandler.file(for: URL(string: "psq://localhost/../../etc/hosts")!, in: root), "cannot escape the bundle")
        XCTAssertEqual(BundleSchemeHandler.file(for: URL(string: "psq://localhost/port-side-quests/")!, in: root)?.lastPathComponent, "index.html")
    }
}
