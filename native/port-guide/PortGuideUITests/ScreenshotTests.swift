import XCTest

/// First launch: the "what are you interested in?" screen, then Add cruise (there are no cruises until you add one).
final class ScreenshotTests: XCTestCase {
    func snap(_ app: XCUIApplication, _ name: String) {
        let a = XCTAttachment(screenshot: app.screenshot()); a.name = name; a.lifetime = .keepAlways; add(a)
    }
    func text(_ web: XCUIElement, _ s: String) -> XCUIElement {
        web.staticTexts.matching(NSPredicate(format: "label CONTAINS %@", s)).firstMatch
    }
    func button(_ web: XCUIElement, _ s: String) -> XCUIElement {
        web.buttons.matching(NSPredicate(format: "label CONTAINS %@", s)).firstMatch
    }
    func testFirstRunAndAddCruise() {
        let app = XCUIApplication()
        app.launch()
        let web = app.webViews.firstMatch
        XCTAssertTrue(web.waitForExistence(timeout: 15))
        // A fresh install opens on the interests screen; a simulator that ran the tests before may already be past it.
        if text(web, "Welcome aboard").waitForExistence(timeout: 20) {
            snap(app, "1-welcome")
            for pick in ["Coffee", "Barber shop"] { let b = button(web, pick); if b.waitForExistence(timeout: 5) { b.tap() } }
            let save = button(web, "Save and continue")
            for _ in 0..<6 where !save.isHittable { web.swipeUp() }
            XCTAssertTrue(save.waitForExistence(timeout: 5), "Save button")
            save.tap(); sleep(2)
        }
        XCTAssertTrue(text(web, "Add a cruise").waitForExistence(timeout: 20), "with no cruises the app opens on Add cruise")
        sleep(3); snap(app, "2-add-cruise")
        let near = button(web, "Near me")
        if near.waitForExistence(timeout: 5) { near.tap(); sleep(3); snap(app, "3-near-me") }
    }
}
