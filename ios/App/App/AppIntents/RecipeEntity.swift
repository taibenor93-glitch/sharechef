import AppIntents
import CoreSpotlight
import Foundation

// A saved recipe, as Siri and Spotlight see it.
// The web app's model is src/types/recipe.ts; RecipeStore holds the copy kept
// on this iPhone.

@available(iOS 27.3, *)
struct RecipeEntity: AppEntity, IndexedEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Recipe")
    static let defaultQuery = RecipeEntityQuery()

    let id: String

    @Property(title: "Title")
    var title: String

    @Property(title: "Ingredients")
    var ingredients: [String]

    @Property(title: "Tags")
    var tags: [String]

    @Property(title: "Cook Time in Minutes")
    var cookTimeMinutes: Int?

    let summary: String

    init(_ recipe: StoredRecipe) {
        self.id = recipe.id
        self.summary = recipe.summary
        self.title = recipe.title
        self.ingredients = recipe.ingredients
        self.tags = recipe.tags
        self.cookTimeMinutes = recipe.cookTimeMinutes
    }

    var displayRepresentation: DisplayRepresentation {
        let line = ingredients.prefix(4).joined(separator: ", ")
        return DisplayRepresentation(title: "\(title)", subtitle: "\(line)")
    }

    // What Spotlight's semantic index reads, so "that lemon chicken thing"
    // can find a recipe by its ingredients and tags, not only its title.
    var attributeSet: CSSearchableItemAttributeSet {
        let attributes = CSSearchableItemAttributeSet(contentType: .text)
        attributes.title = title
        attributes.displayName = title
        attributes.contentDescription = ([summary] + ingredients).filter { !$0.isEmpty }.joined(separator: ". ")
        attributes.keywords = ingredients + tags
        return attributes
    }
}

@available(iOS 27.3, *)
struct RecipeEntityQuery: EntityStringQuery {
    func entities(for identifiers: [RecipeEntity.ID]) async throws -> [RecipeEntity] {
        RecipeStore.shared.find(ids: identifiers).map { RecipeEntity($0) }
    }

    func entities(matching string: String) async throws -> [RecipeEntity] {
        RecipeStore.shared.search(string).map { RecipeEntity($0) }
    }

    func suggestedEntities() async throws -> [RecipeEntity] {
        RecipeStore.shared.all().prefix(10).map { RecipeEntity($0) }
    }
}

// Keeps Spotlight in step with RecipeStore.
@available(iOS 27.3, *)
enum RecipeIndexer {
    /// Makes this iPhone's copy match `recipes`. Returns how many are indexed.
    static func replaceAll(_ recipes: [StoredRecipe]) async -> Int {
        let removed = RecipeStore.shared.replaceAll(recipes)
        let index = CSSearchableIndex.default()
        do {
            if !removed.isEmpty {
                try await index.deleteAppEntities(identifiedBy: removed, ofType: RecipeEntity.self)
            }
            if !recipes.isEmpty {
                try await index.indexAppEntities(recipes.map { RecipeEntity($0) })
            }
        } catch {
            // The store is already correct, so the intents still work. Spotlight
            // catches up on the next sync.
            print("[recipe-index] Spotlight update failed: \(error.localizedDescription)")
        }
        return recipes.count
    }
}
