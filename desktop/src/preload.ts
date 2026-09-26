import { contextBridge, ipcRenderer } from "electron";

export type AiClient = "claude-code" | "cursor" | "gemini" | "local";

export interface ProjectEntry {
  path: string;
  name: string;
  profile: "dev" | "notes";
  aiClient: AiClient;
  running: boolean;
}

contextBridge.exposeInMainWorld("brainInstaller", {
  chooseFolder: (): Promise<string | null> => ipcRenderer.invoke("choose-folder"),
  hasProfile: (root: string): Promise<boolean> => ipcRenderer.invoke("has-profile", root),
  setupProject: (root: string, profile: "dev" | "notes", aiClient: AiClient): Promise<{ port: number; mcpError?: string }> =>
    ipcRenderer.invoke("setup-project", root, profile, aiClient),
  listProjects: (): Promise<ProjectEntry[]> => ipcRenderer.invoke("list-projects"),
  openProject: (root: string): Promise<{ port: number }> => ipcRenderer.invoke("open-project", root),
  removeProject: (root: string): Promise<boolean> => ipcRenderer.invoke("remove-project", root),
  changeAiClient: (root: string, aiClient: AiClient): Promise<{ mcpError?: string }> => ipcRenderer.invoke("change-ai-client", root, aiClient),
  changeProfile: (root: string, profile: "dev" | "notes"): Promise<boolean> => ipcRenderer.invoke("change-profile", root, profile),
});
