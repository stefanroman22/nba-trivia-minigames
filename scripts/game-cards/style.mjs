// The look every card is generated in. Extracted from the Series Winner card
// (src/assets/Games Backrounds/playoff_series.jpg), which is the reference.
import { BRAND } from "./lib.mjs";

export const STYLE_PROMPT = `Premium 3D-rendered scene for a dark sports game card, 16:9, cinematic studio lighting.

Palette: deep charcoal black surfaces (#101010), matte dark metal, dark marble and bevelled panels, with ONE accent colour only: burnt orange (${BRAND}) used as rim light, glowing edges, thin light tubes and small highlights, with warm copper reflections on the floor. No blue, no green, no purple, no other hue anywhere.

Composition: the subject sits centred and fills the middle of the frame; the bottom third stays dark and uncluttered because a title is overlaid there later. Subtle fog, clean floor reflections, shallow depth of field, slight hexagonal / geometric panel patterns in the background. The feel is an arcade scoreboard: blocky, sporty, tight, premium. Not cartoon, not corporate.`;

export const NEGATIVE = `Strict rules: no text, no letters, no numbers, no words, no logos, no watermarks, no brand marks, no team crests, no real people, no recognisable faces, no jersey names. Only abstract figures, silhouettes, equipment, trophies, boards and light.`;

/** Appended when a subject photo is attached so the model treats it as content, not style. */
export const REF_NOTE = `Image 1 is the STYLE reference (match its palette, lighting, materials and mood exactly). Image 2, if present, is the SUBJECT reference: keep its composition and main shapes, but re-render it fully in the style of image 1 and strip any text, logos or faces it contains.`;
