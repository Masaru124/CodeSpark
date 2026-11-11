/**
 * The registration sheet spells the same college many ways ("AMCEC", "AMC
 * Engeneering College", "See photos Map of … DSATM", "Addhichunchanagiri…").
 * Teams are matched on name + college, so without this a re-upload of the same
 * sheet would create a second team for every messy spelling. These rules map the
 * known variants onto the names already stored; anything unknown is only
 * whitespace-normalised, never guessed.
 */
const AMC = "AMC Engineering College";
const GSSS = "GSSS Institute of Engineering and Technology for Women, Mysore";
const DSATM = "Dayananda Sagar Academy of Technology and Management";
const PES_SHIVAMOGGA = "PES Institute of Technology and Management, Shivamogga";
const ADICHUNCHANAGIRI = "Adichunchanagiri Institute of Technology, Chikkamagaluru";

export function canonicalCollege(value: string | null | undefined): string | null {
  const raw = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw) return null;

  const compact = raw.toLowerCase().replace(/[^a-z]/g, "");

  if (compact.startsWith("amc")) return AMC;
  if (compact.startsWith("gsss")) return GSSS;
  if (compact.includes("dayanandasagaracademy") || compact.includes("dsatm")) return DSATM;
  if (compact.startsWith("pes") && compact.includes("shiv")) return PES_SHIVAMOGGA;
  if (compact.includes("chunchanagiri") || compact.includes("chunchangiri")) {
    return ADICHUNCHANAGIRI;
  }

  return raw;
}
