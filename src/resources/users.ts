import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { User, CurrentUser, CreateUserInput, UpdateUserInput } from "../types.js";

export class UsersResource {
  constructor(private readonly request: RequestFn) {}

  /** The user the API token belongs to (`GET /user`). */
  async me(): Promise<CurrentUser> {
    return this.request<CurrentUser>("/user");
  }

  async list(): Promise<User[]> {
    return this.request<User[]>("/users");
  }

  async get(userId: number): Promise<User | null> {
    try {
      return await this.request<User>(`/users/${userId}`);
    } catch (e) {
      if (e instanceof SemaphoreApiError && e.isNotFound) return null;
      throw e;
    }
  }

  async create(input: CreateUserInput): Promise<User> {
    return this.request<User>("/users", {
      method: "POST",
      body: {
        name: input.name,
        username: input.username,
        email: input.email,
        password: input.password,
        admin: input.admin ?? false,
      },
    });
  }

  async update(userId: number, input: UpdateUserInput): Promise<void> {
    await this.request(`/users/${userId}`, {
      method: "PUT",
      body: {
        id: userId,
        ...(input.name !== undefined && { name: input.name }),
        ...(input.username !== undefined && { username: input.username }),
        ...(input.email !== undefined && { email: input.email }),
        ...(input.password !== undefined && { password: input.password }),
        ...(input.admin !== undefined && { admin: input.admin }),
      },
    });
  }

  async delete(userId: number): Promise<void> {
    await this.request(`/users/${userId}`, { method: "DELETE" });
  }
}
