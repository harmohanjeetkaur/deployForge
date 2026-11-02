resource "azurerm_container_registry" "deployforge" {
  name                = "${var.project_name}acr${var.environment}"
  resource_group_name = azurerm_resource_group.deployforge.name
  location            = azurerm_resource_group.deployforge.location
  sku                 = "Basic"
  admin_enabled       = false

  tags = {
    project     = var.project_name
    environment = var.environment
    managed_by  = "terraform"
  }
}