variable "project_name" {
  description = "Name of the project"
  type        = string
  default     = "deployforge"
}

variable "environment" {
  description = "Deployment environment"
  type        = string
  default     = "dev"
}

variable "location" {
  description = "Azure region for resources"
  type        = string
  default     = "centralindia"
}

variable "aks_node_count" {
  description = "Number of AKS worker nodes"
  type        = number
  default     = 1

  validation {
    condition     = var.aks_node_count >= 1
    error_message = "AKS must have at least one node."
  }
}

variable "aks_vm_size" {
  description = "Virtual machine size for AKS nodes"
  type        = string
  default     = "Standard_B2s"
}