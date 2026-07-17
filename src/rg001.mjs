import { matchesAny } from "./glob.mjs";

function evidenceForRequirement(changed, requirement, testCategories) {
  const actual = [];
  for (const category of requirement.anyOf) {
    const paths = changed.filter((path) => matchesAny(path, testCategories[category]));
    if (paths.length > 0) actual.push({ category, paths });
  }
  return actual;
}

export function evaluateRg001(config, changed) {
  const findings = [];
  const satisfied = [];
  for (const mapping of config.highImpactMappings) {
    const businessPaths = changed.filter((path) => matchesAny(path, mapping.businessPaths));
    if (businessPaths.length === 0) continue;
    for (const requirement of mapping.requirements) {
      const actualEvidence = evidenceForRequirement(changed, requirement, config.testCategories);
      const result = {
        rule: "RG001",
        businessPaths,
        requiredTestCategories: requirement.anyOf,
        actualEvidence,
        message: actualEvidence.length > 0
          ? "Required companion test category and change evidence are present; semantic coverage is not asserted."
          : "High-impact change is missing a mapped companion test category in this change.",
        semanticCoverageVerified: false,
        waivable: true,
      };
      (actualEvidence.length > 0 ? satisfied : findings).push(result);
    }
  }
  return { findings, satisfied };
}
