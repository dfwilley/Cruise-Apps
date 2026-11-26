import XCTest

/// Opens the app, checks the planner loads from inside the app, and saves screenshots.
final class ScreenshotTests: XCTestCase {
    func snap(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    func testScreens() {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        let headline = web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "Make the most")).firstMatch
        XCTAssertTrue(headline.waitForExistence(timeout: 15), "screens loaded inside the app")
        snap(app, "1-start")
        for i in 2...4 { web.swipeUp(); sleep(1); snap(app, "\(i)-planner") }
    }
}
