const PREDEFINED_QUERIES = [
  "Doctor in Texas",
  "IT jobs",
  "CEO Jobs",
  "Remote RN",
  "Software Engineer",
  "Nurse practitioner",
  "Data analyst remote",
  "Marketing manager",
  "Project manager",
  "Healthcare administration",
] as const;

export function randomSearchQuery(): string {
  const i = Math.floor(Math.random() * PREDEFINED_QUERIES.length);
  return PREDEFINED_QUERIES[i] ?? "Software Engineer";
}
