import AppIntents
import Foundation

// The two things Siri AI can do with saved recipes. Each does one job; the app
// skill in Skills.skillsbundle tells Siri how to use them together.
//
// ShareChef has no meal plan, so the second action is the app's real core
// action: cooking.

@available(iOS 27.3, *)
struct FindRecipeIntent: AppIntent {
    static let title: LocalizedStringResource = "Find Saved Recipe"
    static let description = IntentDescription(
        "Searches the recipes the user saved in ShareChef by dish name, ingredient, or tag. Returns the matching recipes."
    )

    @Parameter(
        title: "Search",
        description: "A dish name, an ingredient, or a tag, for example \"lemon chicken\" or \"gluten-free\"."
    )
    var query: String

    func perform() async throws -> some IntentResult & ReturnsValue<[RecipeEntity]> & ProvidesDialog {
        let found = RecipeStore.shared.search(query).map { RecipeEntity($0) }
        let spoken: String
        switch found.count {
        case 0:
            spoken = "I couldn't find a saved recipe for \(query) in ShareChef."
        case 1:
            spoken = "I found \(found[0].title) in your saved recipes."
        default:
            let names = found.prefix(3).map { $0.title }.joined(separator: ", ")
            spoken = "I found \(found.count) saved recipes: \(names)."
        }
        return .result(value: found, dialog: IntentDialog(stringLiteral: spoken))
    }
}

@available(iOS 27.3, *)
struct CookRecipeIntent: AppIntent {
    static let title: LocalizedStringResource = "Cook Saved Recipe"
    static let description = IntentDescription(
        "Opens one saved recipe in ShareChef so the user can cook it with Micheli."
    )
    static let openAppWhenRun: Bool = true

    @Parameter(title: "Recipe", description: "The saved recipe to cook.")
    var recipe: RecipeEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        // Same private handoff as the Siri phrases (MicheliSiriPlugin.swift):
        // the web app opens the recipe, after its own sign-in check.
        MicheliSiriInbox.shared.put(action: "recipe", payload: recipe.id)
        return .result()
    }
}
