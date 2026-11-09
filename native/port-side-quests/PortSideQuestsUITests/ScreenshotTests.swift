import XCTest

/// Opens the app, picks a Rhine port, shows quests and the journal, and saves screenshots.
final class ScreenshotTests: XCTestCase {
    func snap(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    func testScreens() {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        XCTAssertTrue(web.staticTexts["Port Side Quests"].firstMatch.waitForExistence(timeout: 15), "screens loaded inside the app")
        snap(app, "1-port-stop")
        // Tapping the label ticks the "I checked the all-aboard time" box
        let confirm = web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", "I checked the all-aboard")).firstMatch
        if confirm.waitForExistence(timeout: 5) { for _ in 0..<6 where !confirm.isHittable { web.swipeUp() }; if confirm.isHittable { confirm.tap() } }
        let start = web.buttons["Start this quest"].firstMatch
        if start.waitForExistence(timeout: 8) {
            for _ in 0..<8 where !start.isHittable { web.swipeUp() }
            sleep(1); snap(app, "2-quests")
            if start.isHittable { start.tap(); sleep(1); snap(app, "3-active-quest") }
        }
        let journal = web.buttons.matching(NSPredicate(format: "label BEGINSWITH %@", "Journal")).firstMatch
        if journal.waitForExistence(timeout: 5) { journal.tap(); sleep(1); snap(app, "4-journal") }
        let shared = web.buttons["Shared trip"].firstMatch
        if shared.waitForExistence(timeout: 5) { shared.tap(); sleep(1); snap(app, "5-shared-trip") }
    }
}
