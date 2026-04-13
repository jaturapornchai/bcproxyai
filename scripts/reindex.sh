#!/bin/bash
# Re-index SMLGateway codebase for qmd semantic search
PYTHONIOENCODING=utf-8 python -m qmd update smlgateway 2>&1
PYTHONIOENCODING=utf-8 python -m qmd embed 2>&1
echo "Reindex complete: $(date)"
