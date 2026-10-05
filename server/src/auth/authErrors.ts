import { WditError } from "../errors/index.js";

export class UnauthorizedError<T extends Record<string, any> = Record<string, string>> extends WditError<T> {
  constructor() {
    super("Unauthorized", 401);
  }
}

export class InvalidCredentialsError extends WditError {
  static key: string = "InvalidCredentials";

  constructor(message?: string) {
    super(InvalidCredentialsError.key, 400, message ?? InvalidCredentialsError.key);
  }
}

export class UserAlreadyExists extends WditError {
  static key: string = "UserAlreadyExists";

  constructor(message?: string) {
    super(UserAlreadyExists.key, 400, message);
  }
}

