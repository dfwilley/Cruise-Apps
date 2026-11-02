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

    /// The river voyage on the Würzburg day: hero, Ideas, and the hours tab; then the Near me and Add cruise screens.
    func testRiverVoyage() {
        let app = XCUIApplication()
        app.launchArguments = ["-previewNow", "2027-05-11T08:00:00Z"]
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        XCTAssertTrue(web.staticTexts["Würzburg"].firstMatch.waitForExistence(timeout: 15), "river voyage opens on Würzburg")
        sleep(2); snap(app, "5-river")
        for (tab, name) in [("Ideas", "6-ideas"), ("Hours", "7-river-hours"), ("Money", "8-euro")] {
            let b = web.buttons.matching(NSPredicate(format: "label CONTAINS %@", tab)).firstMatch
            if b.waitForExistence(timeout: 5) { b.tap(); sleep(2); snap(app, name); web.swipeUp(); sleep(1); snap(app, name + "b") }
        }
        web.swipeDown(); web.swipeDown()
        let add = web.buttons.matching(NSPredicate(format: "label CONTAINS %@", "Add cruise")).firstMatch
        if add.waitForExistence(timeout: 5) {
            add.tap(); sleep(1)
            XCTAssertTrue(web.buttons["Read itinerary"].firstMatch.waitForExistence(timeout: 5), "Add cruise screen opens")
            snap(app, "9-add-cruise")
        }
    }
}
