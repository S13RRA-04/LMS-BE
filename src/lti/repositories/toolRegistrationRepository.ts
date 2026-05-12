import type { RegisteredToolConfig } from "../../config/config.js";
import { AppError } from "../../errors/AppError.js";
import type { RegisteredTool } from "../ltiTypes.js";

export class ToolRegistrationRepository {
  private readonly toolsByClientId = new Map<string, RegisteredTool>();

  constructor(tools: RegisteredToolConfig[]) {
    for (const tool of tools) {
      this.toolsByClientId.set(tool.clientId, tool);
    }
  }

  findByClientId(clientId: string): RegisteredTool | undefined {
    return this.toolsByClientId.get(clientId);
  }

  requireByClientId(clientId: string): RegisteredTool {
    const tool = this.findByClientId(clientId);
    if (!tool) {
      throw new AppError(404, "TOOL_NOT_REGISTERED", "LTI tool is not registered");
    }
    return tool;
  }
}
