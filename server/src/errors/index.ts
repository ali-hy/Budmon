import express from "express";

export class BudmonError<
  T extends Record<string, any> = Record<string, string>,
> extends Error {
  key: string;
  message: string;
  status: number;
  details?: T | undefined;

  constructor(key: string, status: number, message?: string, details?: T) {
    super(message);
    this.key = key;
    this.message = message ?? key;
    this.status = status;
    this.details = details;
  }

  toSerializable() {
    return {
      key: this.key,
      message: this.message,
      status: this.status,
      details: this.details,
    };
  }
}

export class ValidationError extends BudmonError {}

export const errorHandler: express.ErrorRequestHandler = (
  err,
  req,
  res,
  next,
) => {
  console.log("ERROR: ", err);
  if (res.headersSent) {
    return next(err);
  }

  // Unrecognized error then 500
  if (!(err instanceof BudmonError)) {
    res.status(500);

    if (typeof err === "string") res.send(err);
    else if (typeof err === "object")
      res.json({
        ...err,
      });
    return;
  }

  // Recognized BudmonError then
  res.status(err.status).json(err.toSerializable());
};
