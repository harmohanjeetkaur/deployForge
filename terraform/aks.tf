resource "azurerm_kubernetes_cluster" "deployforge" {
  name                = "aks-${var.project_name}-${var.environment}"
  location            = azurerm_resource_group.deployforge.location
  resource_group_name = azurerm_resource_group.deployforge.name
  dns_prefix          = "${var.project_name}-${var.environment}"
  sku_tier            = "Free"

  default_node_pool {
    name       = "system"
    node_count = var.aks_node_count
    vm_size    = var.aks_vm_size
  }

  identity {
    type = "SystemAssigned"
  }

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}