import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type {
  Workflow,
  WorkflowNode,
  WorkflowEdge,
  CreateWorkflowInput,
  UpdateWorkflowInput,
  WorkflowNodeInput,
  WorkflowEdgeInput,
  WorkflowRun,
  WorkflowApproval,
} from "../types.js";

/**
 * Workflows: graphs of task templates that run as one unit, with optional
 * approval gates between nodes. Added in Semaphore 2.19.
 *
 * Availability caveat: these endpoints always answer, but a build with the
 * Workflows feature disabled serves a stub — list returns `200 []` and
 * everything else 404, which is indistinguishable from "no workflows yet".
 * Verified working end to end (create + run) against the official
 * semaphoreui/semaphore:v2.19.8 image.
 *
 * The server validates the graph before persisting it: an empty node list is
 * rejected ("workflow must contain at least one node") and so is a graph
 * without exactly one root node ("workflow must have exactly one root node").
 */
export class WorkflowsResource {
  constructor(private readonly request: RequestFn) {}

  async list(projectId: number): Promise<Workflow[]> {
    return this.request<Workflow[]>(`/project/${projectId}/workflows`);
  }

  async get(projectId: number, workflowId: number): Promise<Workflow | null> {
    try {
      return await this.request<Workflow>(`/project/${projectId}/workflows/${workflowId}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateWorkflowInput): Promise<Workflow> {
    return this.request<Workflow>(`/project/${input.projectId}/workflows`, {
      method: "POST",
      body: {
        project_id: input.projectId,
        name: input.name,
        ...(input.description !== undefined && { description: input.description }),
        nodes: input.nodes.map(serializeNode),
        edges: (input.edges ?? []).map(serializeEdge),
      },
    });
  }

  /**
   * Partial update. The server's PUT is a full replace and rejects a body with
   * no nodes ("workflow must contain at least one node"), so anything not given
   * is re-sent from the current workflow — same approach as schedules.update().
   */
  async update(projectId: number, workflowId: number, input: UpdateWorkflowInput): Promise<void> {
    const current = await this.get(projectId, workflowId);
    if (current === null) {
      throw new Error(`Workflow ${workflowId} not found`);
    }
    const nodes = input.nodes ?? current.nodes.map(nodeToInput);
    const edges = input.edges ?? current.edges.map(edgeToInput);
    await this.request(`/project/${projectId}/workflows/${workflowId}`, {
      method: "PUT",
      body: {
        id: workflowId,
        project_id: projectId,
        name: input.name ?? current.name,
        ...((input.description ?? current.description) !== undefined && {
          description: input.description ?? current.description,
        }),
        nodes: nodes.map(serializeNode),
        edges: edges.map(serializeEdge),
      },
    });
  }

  async delete(projectId: number, workflowId: number): Promise<void> {
    await this.request(`/project/${projectId}/workflows/${workflowId}`, { method: "DELETE" });
  }

  /** Starts a run. The returned run carries `root_task_id` to follow its output. */
  async run(projectId: number, workflowId: number): Promise<WorkflowRun> {
    return this.request<WorkflowRun>(`/project/${projectId}/workflows/${workflowId}/run`, {
      method: "POST",
      body: {},
    });
  }

  async listRuns(projectId: number, workflowId: number): Promise<WorkflowRun[]> {
    return this.request<WorkflowRun[]>(`/project/${projectId}/workflows/${workflowId}/runs`);
  }

  async getRun(projectId: number, workflowId: number, runId: number): Promise<WorkflowRun | null> {
    try {
      return await this.request<WorkflowRun>(
        `/project/${projectId}/workflows/${workflowId}/runs/${runId}`,
      );
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async stopRun(projectId: number, workflowId: number, runId: number): Promise<void> {
    await this.request(`/project/${projectId}/workflows/${workflowId}/runs/${runId}/stop`, {
      method: "POST",
      body: {},
    });
  }

  async listRunArtifacts(projectId: number, workflowId: number, runId: number): Promise<unknown[]> {
    return this.request<unknown[]>(
      `/project/${projectId}/workflows/${workflowId}/runs/${runId}/artifacts`,
    );
  }

  /** Pending approval gates of a run. Empty while no node is waiting. */
  async listApprovals(
    projectId: number,
    workflowId: number,
    runId: number,
  ): Promise<WorkflowApproval[]> {
    return this.request<WorkflowApproval[]>(
      `/project/${projectId}/workflows/${workflowId}/runs/${runId}/approvals`,
    );
  }

  /** Resolves one approval gate, letting the run continue or aborting it. */
  async resolveApproval(
    projectId: number,
    workflowId: number,
    runId: number,
    nodeId: number,
    approved: boolean,
  ): Promise<void> {
    await this.request(
      `/project/${projectId}/workflows/${workflowId}/runs/${runId}/approvals/${nodeId}`,
      { method: "POST", body: { status: approved ? "approved" : "rejected" } },
    );
  }
}

function serializeNode(node: WorkflowNodeInput): Record<string, unknown> {
  return {
    ...(node.id !== undefined && { id: node.id }),
    kind: node.kind,
    ...(node.templateId !== undefined && { template_id: node.templateId }),
    ...(node.convergenceMode !== undefined && { convergence_mode: node.convergenceMode }),
    ...(node.approvalTimeout !== undefined && { approval_timeout: node.approvalTimeout }),
    ...(node.approvalMessage !== undefined && { approval_message: node.approvalMessage }),
    ...(node.note !== undefined && { note: node.note }),
    position_x: node.positionX ?? 0,
    position_y: node.positionY ?? 0,
  };
}

/** Existing node -> input, keeping its id so the edges keep pointing at it. */
function nodeToInput(node: WorkflowNode): WorkflowNodeInput {
  return {
    id: node.id,
    kind: node.kind,
    ...(node.template_id !== undefined && { templateId: node.template_id }),
    ...(node.convergence_mode !== undefined && { convergenceMode: node.convergence_mode }),
    ...(node.approval_timeout !== undefined && { approvalTimeout: node.approval_timeout }),
    ...(node.approval_message !== undefined && { approvalMessage: node.approval_message }),
    ...(node.note !== undefined && { note: node.note }),
    positionX: node.position_x,
    positionY: node.position_y,
  };
}

function edgeToInput(edge: WorkflowEdge): WorkflowEdgeInput {
  return {
    sourceNodeId: edge.source_node_id,
    destinationNodeId: edge.destination_node_id,
    condition: edge.condition,
  };
}

function serializeEdge(edge: WorkflowEdgeInput): Record<string, unknown> {
  return {
    source_node_id: edge.sourceNodeId,
    destination_node_id: edge.destinationNodeId,
    condition: edge.condition,
  };
}
