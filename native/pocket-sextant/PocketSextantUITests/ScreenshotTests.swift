import XCTest

/// Opens the app, checks the sextant loads from inside the app, and saves a screenshot of each tab.
final class ScreenshotTests: XCTestCase {
    func snap(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    func testScreens() {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        let start = web.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Start Sextant")).firstMatch
        XCTAssertTrue(start.waitForExistence(timeout: 15), "screens loaded inside the app")
        snap(app, "1-shoot")
        for (i, tab) in ["Log", "Fix", "Almanac", "Setup", "Help"].enumerated() {
            let b = web.buttons.matching(NSPredicate(format: "label CONTAINS %@", tab)).firstMatch
            if b.exists { b.tap(); sleep(1); snap(app, "\(i + 2)-\(tab.lowercased())") }
        }
    }
}
