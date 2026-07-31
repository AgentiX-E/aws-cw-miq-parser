# Complete CI/CD Workflow: Validate MIQ Queries in Terraform

This directory contains a complete, production-ready example of integrating
`@agentix-e/aws-cw-miq-parser` into a CI/CD pipeline that validates
CloudWatch Metrics Insights queries embedded in Terraform configurations.

## Files

```
examples/terraform-ci/
├── main.tf                    # Sample Terraform with MIQ metric alarms
├── validate-queries.ts        # CI script: parse + validate + lint all MIQ queries
├── .github/workflows/         # GitHub Actions workflow (copy to your repo)
│   └── validate-miq.yml
└── README.md                  # This file
```

## Quick Start

```bash
# 1. Install dependencies
pnpm add @agentix-e/aws-cw-miq-parser

# 2. Run validation locally
npx tsx examples/terraform-ci/validate-queries.ts terraform/

# 3. Copy the CI workflow to your repository
cp examples/terraform-ci/.github/workflows/validate-miq.yml .github/workflows/
```

## What It Validates

| Check | Error Level | Description |
|-------|-------------|-------------|
| Syntax errors | **Error** | MIQ query string cannot be parsed (blocks deployment) |
| Missing LIMIT on GROUP BY | **Error** | Queries with GROUP BY must have LIMIT (blocks deployment) |
| Bare namespace with WHERE | **Warning** | Prefer SCHEMA() with explicit dimensions |
| Excessive GROUP BY keys | **Warning** | >3 GROUP BY dimensions may produce too many time series |
| Reserved keywords | **Warning** | Dimension names that collide with reserved keywords |
