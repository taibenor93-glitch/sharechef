import AppIntents
import Foundation

// What Siri can do with ShareChef. Two requests, nothing else.
//
//   "Hey Siri, cook with Micheli"
//       Opens ShareChef and starts a cook.
//
//   "Hey Siri, ask Micheli what I can make"
//       Siri asks "With what?". The answer ("chicken and rice") opens ShareChef
//       with those ingredients filled in.
//
// Two rules from Apple shape the wording:
//   1. Every phrase must contain the app's name. "Micheli" counts because it is
//      listed as a second name for the app (INAlternativeAppNames, Info.plist).
//      "ShareChef" works in the same place.
//   2. Free words cannot sit inside the phrase itself, so the ingredients are a
//      follow-up question rather than part of the sentence.
//
// Both intents only leave a request for the web app (MicheliSiriPlugin.swift).
// Sign-in, the free-cook limit and everything else are decided there, exactly
// as if the user had tapped the button.

@available(iOS 16.4, *)
struct CookWithMicheliIntent: AppIntent {
    static let title: LocalizedStringResource = "Cook with Micheli"
    static let description = IntentDescription("Opens ShareChef and starts a hands-free cook with Micheli.")
    static let openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        MicheliSiriInbox.shared.put(action: "cook")
        return .result()
    }
}

@available(iOS 16.4, *)
struct WhatCanIMakeIntent: AppIntent {
    static let title: LocalizedStringResource = "What Can I Make"
    static let description = IntentDescription("Opens ShareChef with the ingredients you say filled in.")
    static let openAppWhenRun: Bool = true

    @Parameter(title: "Ingredients", requestValueDialog: IntentDialog("With what?"))
    var ingredients: String

    @MainActor
    func perform() async throws -> some IntentResult {
        MicheliSiriInbox.shared.put(action: "make", payload: ingredients)
        return .result()
    }
}

@available(iOS 16.4, *)
struct MicheliAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CookWithMicheliIntent(),
            phrases: [
                "Cook with \(.applicationName)"
            ],
            shortTitle: "Cook with Micheli",
            systemImageName: "fork.knife"
        )
        AppShortcut(
            intent: WhatCanIMakeIntent(),
            phrases: [
                "Ask \(.applicationName) what I can make",
                "Ask \(.applicationName) what can I make"
            ],
            shortTitle: "What can I make?",
            systemImageName: "carrot"
        )
    }
}
