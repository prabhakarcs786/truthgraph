import { defineConfig } from "sanity";
import { structureTool } from "sanity/structure";
import { schemaTypes } from "./sanity/schema";

const projectId = process.env.SANITY_STUDIO_PROJECT_ID;
if (!projectId) throw new Error("Set SANITY_STUDIO_PROJECT_ID in your local environment before starting Studio.");

export default defineConfig({
  name: "truthgraph", title: "TruthGraph / Knowledge", projectId,
  dataset: process.env.SANITY_STUDIO_DATASET || "production",
  plugins: [structureTool({ structure: (builder) => builder.list().title("Knowledge workspace").items([
    builder.documentTypeListItem("tgKnowledgeBase").title("Knowledge bases"),
    builder.documentTypeListItem("tgSource").title("Original sources"),
    builder.divider(),
    builder.documentTypeListItem("tgClaim").title("Claims and relationships"),
  ]) })],
  schema: { types: schemaTypes },
});