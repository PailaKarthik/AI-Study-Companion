import { Router } from "express";
import { getHealth, getReadiness } from "../controllers/healthController.js";

export const healthRouter: Router = Router();

healthRouter.get("/health", getHealth);
healthRouter.get("/ready", getReadiness);
