import type { Database } from "./database.types";
import type { Json } from "./database.types";

export type { Database, Json };
export type ApplicationStatus = Database["public"]["Enums"]["application_status"];
export type EmploymentType = Database["public"]["Enums"]["employment_type"];
export type ExecutionStatus = Database["public"]["Enums"]["execution_status"];
export type ExecutionType = Database["public"]["Enums"]["execution_type"];
