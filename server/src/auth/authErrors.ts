import { BudmonError } from "../errors/index.js";

export class UnauthorizedError<T extends Record<string, any> = Record<string, string>> extends BudmonError<T> {
  constructor() {
    super("Unauthorized", 401);
  }
}

export class InvalidCredentialsError extends BudmonError {
  static key: string = "InvalidCredentials";

  constructor(message?: string) {
    super(InvalidCredentialsError.key, 400, message ?? InvalidCredentialsError.key);
  }
}

export class UserAlreadyExists extends BudmonError {
  static key: string = "UserAlreadyExists";

  constructor(message?: string) {
    super(UserAlreadyExists.key, 400, message);
  }
}

