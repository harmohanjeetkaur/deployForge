output "resource_group_name" {
  description = "Name of the Azure Resource Group"
  value       = azurerm_resource_group.deployforge.name
}

output "acr_login_server" {
  description = "Login server for Azure Container Registry"
  value       = azurerm_container_registry.deployforge.login_server
}

output "aks_cluster_name" {
  description = "Name of the AKS cluster"
  value       = azurerm_kubernetes_cluster.deployforge.name
}

output "aks_cluster_id" {
  description = "Azure resource ID of the AKS cluster"
  value       = azurerm_kubernetes_cluster.deployforge.id
}