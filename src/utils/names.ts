/**
 * Adjective + Noun name generator for agent identities.
 * Matches mcp_agent_mail's naming convention.
 */

const ADJECTIVES = [
  "Amber",
  "Azure",
  "Blue",
  "Bright",
  "Bronze",
  "Calm",
  "Clear",
  "Coral",
  "Crimson",
  "Crystal",
  "Cyber",
  "Dark",
  "Dawn",
  "Deep",
  "Desert",
  "Digital",
  "Dusk",
  "Electric",
  "Emerald",
  "Fire",
  "Forest",
  "Frost",
  "Ghost",
  "Golden",
  "Gray",
  "Green",
  "Hidden",
  "Ice",
  "Indigo",
  "Iron",
  "Ivory",
  "Jade",
  "Light",
  "Lunar",
  "Marble",
  "Midnight",
  "Misty",
  "Moon",
  "Neon",
  "Night",
  "Noble",
  "Ocean",
  "Onyx",
  "Orange",
  "Pale",
  "Pearl",
  "Pine",
  "Pink",
  "Platinum",
  "Purple",
  "Quiet",
  "Rapid",
  "Red",
  "River",
  "Rose",
  "Royal",
  "Ruby",
  "Rust",
  "Sacred",
  "Sage",
  "Sand",
  "Sapphire",
  "Scarlet",
  "Secret",
  "Shadow",
  "Silent",
  "Silver",
  "Sky",
  "Slate",
  "Snow",
  "Solar",
  "Spring",
  "Steel",
  "Stone",
  "Storm",
  "Summer",
  "Swift",
  "Thunder",
  "Tidal",
  "Twilight",
  "Velvet",
  "Violet",
  "Warm",
  "White",
  "Wild",
  "Winter",
  "Wise",
];

const NOUNS = [
  "Arrow",
  "Bay",
  "Bear",
  "Bird",
  "Blade",
  "Brook",
  "Canyon",
  "Castle",
  "Cave",
  "Cedar",
  "Cliff",
  "Cloud",
  "Cobra",
  "Cove",
  "Crane",
  "Creek",
  "Crown",
  "Dawn",
  "Deer",
  "Delta",
  "Dove",
  "Dragon",
  "Drift",
  "Dune",
  "Eagle",
  "Elm",
  "Falcon",
  "Fern",
  "Field",
  "Finch",
  "Flame",
  "Flash",
  "Flint",
  "Fox",
  "Frost",
  "Garden",
  "Gate",
  "Glacier",
  "Glen",
  "Grove",
  "Harbor",
  "Hawk",
  "Haven",
  "Heath",
  "Heron",
  "Hill",
  "Hollow",
  "Horn",
  "Isle",
  "Jade",
  "Jaguar",
  "Keep",
  "Lake",
  "Lark",
  "Leaf",
  "Lion",
  "Lodge",
  "Lynx",
  "Maple",
  "Marsh",
  "Mesa",
  "Mill",
  "Mist",
  "Moon",
  "Moss",
  "Mountain",
  "Oak",
  "Oasis",
  "Owl",
  "Palm",
  "Panther",
  "Pass",
  "Path",
  "Peak",
  "Petal",
  "Phoenix",
  "Pine",
  "Plain",
  "Pond",
  "Quail",
  "Raven",
  "Reef",
  "Ridge",
  "River",
  "Rock",
  "Rose",
  "Sage",
  "Sand",
  "Shade",
  "Shore",
  "Sparrow",
  "Spring",
  "Star",
  "Stone",
  "Storm",
  "Stream",
  "Summit",
  "Swan",
  "Thorn",
  "Thunder",
  "Tiger",
  "Tower",
  "Trail",
  "Tree",
  "Vale",
  "Valley",
  "Vine",
  "Vista",
  "Wave",
  "Willow",
  "Wind",
  "Wolf",
  "Wood",
];

function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Generate a random adjective+noun name.
 */
export function generateName(): string {
  return `${randomElement(ADJECTIVES)}${randomElement(NOUNS)}`;
}

/**
 * Validate that a name follows the adjective+noun pattern.
 */
export function isValidName(name: string): boolean {
  // Must be PascalCase with exactly two parts
  const match = name.match(/^([A-Z][a-z]+)([A-Z][a-z]+)$/);
  if (!match) return false;

  const [, adj, noun] = match;
  return ADJECTIVES.includes(adj) && NOUNS.includes(noun);
}

/**
 * Generate a unique name not in the existing set.
 * Falls back to adding numbers if too many collisions.
 */
export function generateUniqueName(existing: Set<string>, hint?: string): string {
  // Try hint first if valid
  if (hint && isValidName(hint) && !existing.has(hint)) {
    return hint;
  }

  // Try random generation up to 100 times
  for (let i = 0; i < 100; i++) {
    const name = generateName();
    if (!existing.has(name)) {
      return name;
    }
  }

  // Fallback: add number suffix
  let suffix = 1;
  let name = generateName();
  while (existing.has(`${name}${suffix}`)) {
    suffix++;
    if (suffix > 100) {
      name = generateName();
      suffix = 1;
    }
  }
  return `${name}${suffix}`;
}
