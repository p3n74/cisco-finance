-- Migration: Add Budget Planning tables
-- Run this on your database to add budget planning functionality

-- Budget Projects table (Events/Projects)
CREATE TABLE IF NOT EXISTS budget_project (
    id VARCHAR(30) PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    category VARCHAR(255),
    event_date TIMESTAMP,
    status VARCHAR(50) DEFAULT 'planned',
    is_active BOOLEAN DEFAULT TRUE,
    archived_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES "user"(id) ON DELETE CASCADE
);

-- Indexes for budget_project
CREATE INDEX IF NOT EXISTS idx_budget_project_user_id ON budget_project(user_id);
CREATE INDEX IF NOT EXISTS idx_budget_project_status ON budget_project(status);
CREATE INDEX IF NOT EXISTS idx_budget_project_is_active ON budget_project(is_active);
CREATE INDEX IF NOT EXISTS idx_budget_project_event_date ON budget_project(event_date);

-- Budget Items table (Individual expense line items)
CREATE TABLE IF NOT EXISTS budget_item (
    id VARCHAR(30) PRIMARY KEY,
    budget_project_id VARCHAR(30) NOT NULL,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    estimated_amount DECIMAL(19,4) NOT NULL,
    notes TEXT,
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_project_id) REFERENCES budget_project(id) ON DELETE CASCADE
);

-- Indexes for budget_item
CREATE INDEX IF NOT EXISTS idx_budget_item_project_id ON budget_item(budget_project_id);
CREATE INDEX IF NOT EXISTS idx_budget_item_is_active ON budget_item(is_active);

-- Budget Item Expenses table (Links budget items to actual cashflow entries)
CREATE TABLE IF NOT EXISTS budget_item_expense (
    id VARCHAR(30) PRIMARY KEY,
    budget_item_id VARCHAR(30) NOT NULL,
    cashflow_entry_id VARCHAR(30) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (budget_item_id) REFERENCES budget_item(id) ON DELETE RESTRICT,
    FOREIGN KEY (cashflow_entry_id) REFERENCES cashflow_entry(id) ON DELETE RESTRICT,
    UNIQUE (budget_item_id, cashflow_entry_id)
);

-- Indexes for budget_item_expense
CREATE INDEX IF NOT EXISTS idx_budget_item_expense_item_id ON budget_item_expense(budget_item_id);
CREATE INDEX IF NOT EXISTS idx_budget_item_expense_cashflow_id ON budget_item_expense(cashflow_entry_id);
