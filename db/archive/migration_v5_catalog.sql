BEGIN;
CREATE TABLE IF NOT EXISTS catalog_customers (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    company_name VARCHAR(200) NOT NULL,
    country_code VARCHAR(2) NOT NULL,
    country_name VARCHAR(100) NOT NULL,
    city_id VARCHAR(30) NOT NULL,
    city_name VARCHAR(200) NOT NULL,
    level VARCHAR(3) NOT NULL CHECK (level IN ('KA','LA','SMB')),
    contacts JSONB NOT NULL DEFAULT '[]',
    notes TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS catalog_products (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    type VARCHAR(10) NOT NULL CHECK (type IN ('OTT','IPC','NetCom')),
    model VARCHAR(200) NOT NULL,
    chipset VARCHAR(200) NOT NULL,
    system VARCHAR(200) NOT NULL,
    repository_url VARCHAR(2000) NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revision INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS catalog_projects (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    number VARCHAR(100) NOT NULL,
    pm VARCHAR(100) NOT NULL,
    start_month VARCHAR(7) NOT NULL CHECK (start_month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    stage VARCHAR(3) NOT NULL CHECK (stage IN ('EV','EVT','DVT','PVT','MR','MP')),
    customer_id UUID NOT NULL REFERENCES catalog_customers(id),
    product_id UUID NOT NULL REFERENCES catalog_products(id),
    created_by UUID NOT NULL REFERENCES users(id),
    updated_by UUID NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    revision INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS catalog_projects_customer_idx ON catalog_projects(customer_id);
CREATE INDEX IF NOT EXISTS catalog_projects_product_idx ON catalog_projects(product_id);
CREATE INDEX IF NOT EXISTS catalog_customers_updated_idx ON catalog_customers(updated_at);
CREATE INDEX IF NOT EXISTS catalog_products_updated_idx ON catalog_products(updated_at);
CREATE INDEX IF NOT EXISTS catalog_projects_updated_idx ON catalog_projects(updated_at);
COMMIT;
