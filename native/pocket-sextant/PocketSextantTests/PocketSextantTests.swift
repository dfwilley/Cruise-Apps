import XCTest
@testable import PocketSextant

final class PocketSextantTests: XCTestCase {
    let root = Bundle.main.resourceURL!.standardizedFileURL

    func testTheWebAppIsInsideTheApp() throws {
        for f in ["pocket-sextant/index.html", "pocket-sextant/sextant-core.js", "pocket-sextant/icon-192.png"] {
            XCTAssertTrue(FileManager.default.fileExists(atPath: root.appendingPathComponent(f).path), f)
        }
    }

    func testSchemeHandlerServesBundleFilesOnly() {
        XCTAssertNotNil(BundleSchemeHandler.file(for: URL(string: "ps://localhost/pocket-sextant/index.html")!, in: root))
        XCTAssertNil(BundleSchemeHandler.file(for: URL(string: "ps://localhost/../../etc/hosts")!, in: root), "cannot escape the bundle")
        XCTAssertEqual(BundleSchemeHandler.file(for: URL(string: "ps://localhost/pocket-sextant/")!, in: root)?.lastPathComponent, "index.html")
    }

    func testOnlyTheSextantStaysInsideTheApp() {
        XCTAssertNil(SextantController.outsideURL(for: URL(string: "ps://localhost/pocket-sextant/index.html")!))
        XCTAssertEqual(SextantController.outsideURL(for: URL(string: "ps://localhost/port-guide/")!)?.absoluteString,
                       "https://dfwilley.github.io/Cruise-Apps/port-guide/")
        XCTAssertEqual(SextantController.outsideURL(for: URL(string: "https://www.example.com/")!)?.host, "www.example.com")
    }

    func testCameraMotionAndLocationPromptsHaveWording() {
        for key in ["NSCameraUsageDescription", "NSMotionUsageDescription", "NSLocationWhenInUseUsageDescription"] {
            XCTAssertFalse((Bundle.main.object(forInfoDictionaryKey: key) as? String ?? "").isEmpty, key)
        }
    }
}
