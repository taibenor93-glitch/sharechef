import Foundation

// The saved recipes Siri can find, kept on this iPhone.
//
// Recipes live in Supabase and only the web app can read them (it holds the
// sign-in). The web app hands the signed-in user's saved recipes to
// RecipeIndexPlugin, which keeps them here so an intent can answer while the
// web app is not running. Signing out empties this file.
//
// Only what Siri needs is kept: no steps, no photo, no account id.
struct StoredRecipe: Codable, Equatable {
    let id: String
    let title: String
    let summary: String
    let ingredients: [String]
    let tags: [String]
    let cookTimeMinutes: Int?
}

final class RecipeStore {
    static let shared = RecipeStore()

    private let lock = NSLock()
    private var cache: [StoredRecipe]?

    private init() {}

    private var fileURL: URL? {
        guard let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }
        return base.appendingPathComponent("RecipeIndex", isDirectory: true).appendingPathComponent("recipes.json")
    }

    func all() -> [StoredRecipe] {
        lock.lock()
        defer { lock.unlock() }
        if let cache = cache { return cache }
        var loaded: [StoredRecipe] = []
        if let url = fileURL, let data = try? Data(contentsOf: url) {
            loaded = (try? JSONDecoder().decode([StoredRecipe].self, from: data)) ?? []
        }
        cache = loaded
        return loaded
    }

    /// Replaces everything. Returns the ids that were here before and are gone
    /// now, so the caller can take them out of Spotlight too.
    @discardableResult
    func replaceAll(_ recipes: [StoredRecipe]) -> [String] {
        let before = all()
        lock.lock()
        defer { lock.unlock() }
        cache = recipes
        if let url = fileURL {
            try? FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            if let data = try? JSONEncoder().encode(recipes) {
                try? data.write(to: url, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
            }
        }
        let kept = Set(recipes.map { $0.id })
        return before.map { $0.id }.filter { !kept.contains($0) }
    }

    func find(ids: [String]) -> [StoredRecipe] {
        let wanted = Set(ids)
        return all().filter { wanted.contains($0.id) }
    }

    /// Plain word search over title, ingredients and tags. Every word in the
    /// question must appear somewhere in the recipe. Title matches come first.
    func search(_ text: String, limit: Int = 10) -> [StoredRecipe] {
        let words = text.lowercased()
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { $0.count > 1 }
        guard !words.isEmpty else { return Array(all().prefix(limit)) }

        var inTitle: [StoredRecipe] = []
        var elsewhere: [StoredRecipe] = []
        for recipe in all() {
            let title = recipe.title.lowercased()
            let rest = (recipe.ingredients + recipe.tags + [recipe.summary]).joined(separator: " ").lowercased()
            let everywhere = title + " " + rest
            guard words.allSatisfy({ everywhere.contains($0) }) else { continue }
            if words.allSatisfy({ title.contains($0) }) { inTitle.append(recipe) } else { elsewhere.append(recipe) }
        }
        return Array((inTitle + elsewhere).prefix(limit))
    }
}
