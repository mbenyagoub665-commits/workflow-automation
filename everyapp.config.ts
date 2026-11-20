import { defineEveryApp } from "@every-app/sdk";

export default defineEveryApp({
  id: "workflow-automation",
  name: "Workflow Automation",
  description:
    "Build workflows of steps that run on demand, on a schedule or from a webhook, with run history, versions and data tables.",
  icon: "/icon.svg",
  access: "everyone",
  resources: {
    d1: ["DB"],
  },
  // A workflow's webhook trigger: called by other systems, never by a member.
  // The route answers 404 unless the unguessable token belongs to an active workflow.
  public: [{ path: "/hook/:token", methods: ["GET", "POST"] }],
  publicAssets: ["/icon.svg"],
  secrets: [
    {
      name: "CREDENTIALS_KEY",
      why: "Encrypts the credentials HTTP request steps use.",
      generate: true,
    },
  ],
  providers: [
    {
      id: "openrouter",
      why: "Answers AI prompt steps.",
      docs: "https://openrouter.ai/keys",
    },
  ],
  capabilities: {
    email: { access: "write", why: "Sends the messages of Send email steps." },
  },
  features: {
    ai: {
      name: "AI prompt steps",
      why: "Lets workflows send a prompt to a model and use its answer.",
      providers: ["openrouter"],
    },
    email: {
      name: "Send email steps",
      why: "Lets workflows send email.",
      capabilities: ["email"],
    },
  },
});
