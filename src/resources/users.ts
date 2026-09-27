import type { RequestFn } from "../client.js";
import { SemaphoreApiError } from "../error.js";
import type { User, CurrentUser, CreateUserInput, UpdateUserInput } from "../types.js";
import { mergeForUpdate, readForUpdate } from "./merge.js";

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

  /**
   * Partial update: reads the user and sends it back whole. `api/users.go`
   * binds the whole struct and persists it like every other PUT, so renaming a
   * user used to blank their email and drop their admin flag.
   */
  async update(userId: number, input: UpdateUserInput): Promise<void> {
    const existing = await readForUpdate<User>(this.request, `/users/${userId}`, "User", userId);

    await this.request(`/users/${userId}`, {
      method: "PUT",
      body: mergeForUpdate(existing, {
        id: userId,
        name: input.name,
        username: input.username,
        email: input.email,
        password: input.password,
        admin: input.admin,
      }),
    });
  }

  async delete(userId: number): Promise<void> {
    await this.request(`/users/${userId}`, { method: "DELETE" });
  }
}
