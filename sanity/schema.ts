import { defineArrayMember, defineField, defineType } from "sanity";
import { validRange } from "semver";
import { knowledgeSourceSchema } from "../src/lib/knowledge";

export const schemaTypes = [
  defineType({ name: "tgInvestigation", title: "Shared investigation", type: "document", fields: [
    defineField({ name: "title", type: "string", readOnly: true }),
    defineField({ name: "knowledgeBaseId", type: "string", readOnly: true }),
    defineField({ name: "recordedAt", type: "datetime", readOnly: true }),
    defineField({ name: "snapshot", type: "text", readOnly: true }),
  ] }),
  defineType({ name: "tgShowcaseCache", title: "Guided-tour result cache", type: "document", readOnly: true, fields: [
    defineField({ name: "fingerprint", type: "string" }),
    defineField({ name: "recordedAt", type: "datetime" }),
    defineField({ name: "result", type: "text" }),
  ] }),
  defineType({ name: "tgRuntimeBudget", title: "Application budget", type: "document", readOnly: true, fields: [
    defineField({ name: "minute", type: "number" }),
    defineField({ name: "minuteUsed", type: "number" }),
    defineField({ name: "day", type: "number" }),
    defineField({ name: "dayUsed", type: "number" }),
    defineField({ name: "allocation", type: "string" }),
  ] }),
  defineType({ name: "tgKnowledgeBase", title: "Knowledge base", type: "document", fields: [
    defineField({ name: "title", type: "string", validation: (rule) => rule.required().max(120) }),
    defineField({ name: "description", title: "Purpose and scope", type: "text", rows: 3, validation: (rule) => rule.required().max(600) }),
    defineField({ name: "kind", type: "string", initialValue: "real", options: { list: ["real", "synthetic"] }, validation: (rule) => rule.required() }),
    defineField({ name: "mcpId", title: "Sanity Knowledge Base ID", type: "string", description: "The kb... ID from the Context Dashboard, not this document's ID. Required for live investigation.", validation: (rule) => rule.regex(/^kb[a-zA-Z0-9_-]+$/) }),
    defineField({ name: "contentChangedAt", title: "Last app content change", type: "datetime", readOnly: true }),
    defineField({ name: "indexReviewedAt", title: "Operator-confirmed index review", type: "datetime", readOnly: true }),
    defineField({ name: "suggestedQuestions", type: "array", of: [defineArrayMember({ type: "string" })], validation: (rule) => rule.max(8) }),
    defineField({ name: "sortOrder", title: "Display order", type: "number", description: "Lower numbers are listed first; the first collection with a guided tour is featured." }),
    defineField({ name: "showcase", title: "Guided tour scenarios", description: "Curated questions that run without an access code. Each explains what plain keyword search would get wrong.", type: "array", validation: (rule) => rule.max(8), of: [defineArrayMember({ type: "object", name: "showcaseScenario", fields: [
      defineField({ name: "title", type: "string", validation: (rule) => rule.required().min(3).max(80) }),
      defineField({ name: "question", type: "string", validation: (rule) => rule.required().min(5).max(500) }),
      defineField({ name: "asOf", title: "As of (optional)", type: "date" }),
      defineField({ name: "lesson", title: "What this demonstrates", type: "text", rows: 3, validation: (rule) => rule.required().min(10).max(400) }),
    ] })] }),
  ] }),
  defineType({ name: "tgSource", title: "Source", type: "document", fields: [
    defineField({ name: "knowledgeBase", type: "reference", to: [{ type: "tgKnowledgeBase" }], validation: (rule) => rule.required() }),
    defineField({ name: "title", type: "string", validation: (rule) => rule.required().max(200) }),
    defineField({ name: "publisher", type: "string", validation: (rule) => rule.required().max(120) }),
    defineField({ name: "url", title: "Original URL or upload fingerprint", type: "string", validation: (rule) => rule.required().custom((value) => knowledgeSourceSchema.shape.url.safeParse(value).success || "Use an HTTPS URL or urn:sha256 content identifier.") }),
    defineField({ name: "fileName", title: "Uploaded filename", type: "string", readOnly: true }),
    defineField({ name: "uploadedText", title: "Original uploaded text", type: "text", readOnly: true }),
    defineField({ name: "authority", type: "string", options: { list: ["primary", "secondary", "unverified"] }, validation: (rule) => rule.required() }),
    defineField({ name: "publishedAt", title: "Publication date, if known", type: "date" }),
    defineField({ name: "reviewedAt", title: "Last source review", type: "date", validation: (rule) => rule.required() }),
  ], preview: { select: { title: "title", subtitle: "publisher" } } }),
  defineType({ name: "tgClaim", title: "Claim", type: "document", groups: [{ name: "claim", title: "Statement", default: true }, { name: "scope", title: "Applicability" }, { name: "relations", title: "Relationships" }], fields: [
    defineField({ name: "knowledgeBase", type: "reference", group: "claim", to: [{ type: "tgKnowledgeBase" }], validation: (rule) => rule.required() }),
    defineField({ name: "source", type: "reference", group: "claim", to: [{ type: "tgSource" }], validation: (rule) => rule.required() }),
    defineField({ name: "subject", type: "string", group: "claim", validation: (rule) => rule.required().max(120) }),
    defineField({ name: "predicate", title: "Property being asserted", type: "string", group: "claim", validation: (rule) => rule.required().max(120) }),
    defineField({ name: "value", type: "string", group: "claim", validation: (rule) => rule.required().max(200) }),
    defineField({ name: "statement", title: "Source-backed statement", type: "text", rows: 4, group: "claim", validation: (rule) => rule.required().min(10).max(1800) }),
    defineField({ name: "aliases", title: "Search terms", type: "array", group: "claim", of: [defineArrayMember({ type: "string" })], validation: (rule) => rule.max(20) }),
    defineField({ name: "exclusive", title: "Only one value can hold in the same scope", type: "boolean", group: "claim", initialValue: false, validation: (rule) => rule.required() }),
    defineField({ name: "version", type: "object", group: "scope", fields: [
      defineField({ name: "subject", title: "Versioned product or subject", type: "string", validation: (rule) => rule.required() }),
      defineField({ name: "aliases", type: "array", of: [defineArrayMember({ type: "string" })], validation: (rule) => rule.max(6) }),
      defineField({ name: "range", type: "string", validation: (rule) => rule.required().custom((value) => !value || Boolean(validRange(value)) || "Enter a valid semantic version range.") }),
    ] }),
    defineField({ name: "effectiveFrom", type: "date", group: "scope" }),
    defineField({ name: "effectiveUntil", title: "Effective until (exclusive)", type: "date", group: "scope" }),
    defineField({ name: "conditions", type: "array", group: "scope", of: [defineArrayMember({ type: "object", name: "applicabilityCondition", fields: [
      defineField({ name: "key", type: "string", validation: (rule) => rule.required() }),
      defineField({ name: "value", type: "string", validation: (rule) => rule.required() }),
    ] })], validation: (rule) => rule.max(10) }),
    defineField({ name: "relations", type: "array", group: "relations", of: [defineArrayMember({ type: "object", name: "claimRelation", fields: [
      defineField({ name: "kind", type: "string", options: { list: ["supersedes", "corrects", "supports", "related"] }, validation: (rule) => rule.required() }),
      defineField({ name: "target", type: "reference", to: [{ type: "tgClaim" }], validation: (rule) => rule.required() }),
      defineField({ name: "reason", type: "text", rows: 3, validation: (rule) => rule.required().min(10).max(600) }),
    ] })], validation: (rule) => rule.max(15) }),
  ], preview: { select: { title: "statement", subject: "subject", predicate: "predicate" }, prepare: ({ title, subject, predicate }) => ({ title, subtitle: `${subject} / ${predicate}` }) } }),
];