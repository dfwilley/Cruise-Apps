import XCTest

/// Opens the app as if it were the morning of the Narvik port day and saves a screenshot of each tab.
final class ScreenshotTests: XCTestCase {
    func snap(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    func testScreens() {
        let app = XCUIApplication()
        app.launchArguments = ["-previewNow", "2027-02-04T09:00:00Z"]
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        XCTAssertTrue(web.staticTexts["Narvik"].firstMatch.waitForExistence(timeout: 15), "screens loaded inside the app")
        sleep(2)
        snap(app, "1-pier")
        web.swipeUp(); sleep(1); snap(app, "2-sights")
        for (tab, name) in [("Hours", "3-hours"), ("Money", "4-money")] {
            let b = web.buttons.matching(NSPredicate(format: "label CONTAINS %@", tab)).firstMatch
            if b.waitForExistence(timeout: 5) { b.tap(); sleep(2); snap(app, name); web.swipeUp(); sleep(1); snap(app, name + "b") }
        }
    }
}
