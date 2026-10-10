"""Procura segredos nos arquivos que vão para o git. Sai com 1 se encontrar algo.

Uso: python tools/check_secrets.py          # arquivos em stage (rode antes de todo commit)
     python tools/check_secrets.py --all    # todos os arquivos rastreados
Linhas com o marcador 'nosecret' são ignoradas: use só para falso positivo confirmado por humano.
"""
import re
import subprocess
import sys
from pathlib import Path

FORBIDDEN_NAMES = re.compile(r"(^|/)(\.env(\..*)?|credentials\.json|token\.json|[^/]*\.(pem|key|p12|pfx))$")
ALLOWED_NAMES = {".env.example"}
PATTERNS = {
    "AWS access key": r"AKIA[0-9A-Z]{16}",
    "GitHub token": r"gh[pousr]_[A-Za-z0-9]{36,}",
    "OpenAI/Anthropic key": r"sk-(ant-)?[A-Za-z0-9_-]{20,}",
    "Google API key": r"AIza[0-9A-Za-z_-]{35}",
    "Slack token": r"xox[abprs]-[A-Za-z0-9-]{10,}",
    "chave privada": r"-----BEGIN [A-Z ]*PRIVATE KEY-----",
    "URL com credencial": r"[a-z]+://[^/\s:]+:[^@\s]{4,}@",
    "credencial em texto": r"(?i)(password|passwd|senha|secret|api[_-]?key|token)\s*[=:]\s*['\"][^'\"]{8,}['\"]",
}


def git_files(*args: str) -> list[str]:
    out = subprocess.run(["git", *args], capture_output=True, text=True, check=True).stdout
    return [f for f in out.split("\n") if f]


def main() -> int:
    if "--all" in sys.argv:
        files = git_files("ls-files")
    else:
        files = git_files("diff", "--cached", "--name-only", "--diff-filter=ACM")

    hits: list[str] = []
    for f in files:
        if FORBIDDEN_NAMES.search(f) and Path(f).name not in ALLOWED_NAMES:
            hits.append(f"{f}: arquivo de segredo não deve ser versionado")
            continue
        try:
            text = Path(f).read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        for n, line in enumerate(text.splitlines(), 1):
            if "nosecret" in line:
                continue
            for label, pat in PATTERNS.items():
                if re.search(pat, line):
                    hits.append(f"{f}:{n}: {label}")

    if hits:
        print("SEGREDO(S) DETECTADO(S) — não commite:", *hits, sep="\n  - ")
        return 1
    print(f"OK: nenhum segredo em {len(files)} arquivo(s)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
