# CI local de COVILLAF SIMULATE: lo mismo que .github/workflows/ci.yml mas lo que solo existe en esta maquina
# (binarios de .herramientas\, carpetas hermanas de COVILLAF DESIGN y COVILLAF 3D).
#   powershell -ExecutionPolicy Bypass -File tools\ci.ps1              # completa
#   powershell -ExecutionPolicy Bypass -File tools\ci.ps1 -Rapido      # sin pruebas "lento" ni "externo"
#   powershell -ExecutionPolicy Bypass -File tools\ci.ps1 -SoloPython  |  -SoloNode
param([switch]$SoloPython, [switch]$SoloNode, [switch]$Rapido)
$ErrorActionPreference = 'Continue'
Set-Location (Split-Path -Parent $PSScriptRoot)
$py = '.venv\Scripts\python.exe'
$versionPython = '3.13'
# F0-17: ningun .pyc junto a las fuentes (y nunca dentro de COVILLAF DESIGN, que es de solo lectura).
$env:PYTHONPYCACHEPREFIX = Join-Path (Get-Location).Path '.herramientas\pycache'
$resultados = New-Object System.Collections.Generic.List[object]

function Paso([string]$nombre, [scriptblock]$accion) {
    Write-Host ''
    Write-Host "==== $nombre ====" -ForegroundColor Cyan
    $inicio = Get-Date
    $global:LASTEXITCODE = 0
    & $accion
    $codigo = $LASTEXITCODE
    $seg = [math]::Round(((Get-Date) - $inicio).TotalSeconds, 1)
    $script:resultados.Add([pscustomobject]@{ Paso = $nombre; Resultado = $(if ($codigo -eq 0) { 'OK' } else { "FALLA ($codigo)" }); Segundos = $seg })
}
function Omitido([string]$nombre, [string]$motivo) {
    Write-Host "AVISO: se omite '$nombre': $motivo" -ForegroundColor Yellow
    $script:resultados.Add([pscustomobject]@{ Paso = $nombre; Resultado = "omitido: $motivo"; Segundos = 0 })
}

if (-not $SoloNode) {
    if (-not (Test-Path $py)) { Write-Host 'Falta .venv: ejecuta tools\instalar.ps1' -ForegroundColor Red; exit 2 }
    $actual = & $py -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"
    if ($actual -ne $versionPython) { Write-Host ".venv es Python $actual; el kernel usa $versionPython (tools\instalar.ps1)" -ForegroundColor Red; exit 2 }

    Paso 'Grafo: validar docs/grafo/grafo.json' { & $py tools\generar_grafo.py --validar }
    Paso 'Grafo: los generados estan al dia' {
        $archivos = @('docs\grafo\grafo.svg', 'docs\grafo\grafo.html', 'docs\grafo\grafo.mmd', 'docs\grafo\README.md')
        $antes = $archivos | ForEach-Object { if (Test-Path $_) { (Get-FileHash $_).Hash } else { 'AUSENTE' } }
        & $py tools\generar_grafo.py | Out-Null
        $despues = $archivos | ForEach-Object { (Get-FileHash $_).Hash }
        if (Compare-Object $antes $despues) { Write-Host 'Los archivos generados del grafo no estaban al dia: regenerados; revisa el diff' -ForegroundColor Red; $global:LASTEXITCODE = 1 } else { $global:LASTEXITCODE = 0 }
    }
    Paso 'Python: ruff' { & $py -m ruff check packages apps tests tools conftest.py }
    $hayModulos = (Get-ChildItem packages, apps -Recurse -Filter pyproject.toml -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0
    if ($hayModulos) { Paso 'Python: import-linter (capas)' { & '.venv\Scripts\lint-imports.exe' } } else { Omitido 'Python: import-linter (capas)' 'todavia no hay modulos Python' }
    if ($Rapido) {
        Paso 'Python: pytest (sin lento ni externo)' { & $py -m pytest -q -p no:cacheprovider -m 'not lento and not externo' }
    } else {
        Paso 'Python: pytest (completo)' { & $py -m pytest -q -p no:cacheprovider }
    }
    Paso 'Entorno: comprobar_entorno.py --rapido' { & $py tools\comprobar_entorno.py --rapido }
}

if (-not $SoloPython) {
    if (-not (Test-Path 'node_modules')) { Write-Host 'Falta node_modules: ejecuta tools\instalar.ps1' -ForegroundColor Red; exit 2 }
    if (Test-Path 'tsconfig.json') { Paso 'TypeScript: tsc' { npx tsc -p tsconfig.json --noEmit } } else { Omitido 'TypeScript: tsc' 'todavia no hay tsconfig.json' }
    $hayPruebasTs = (Get-ChildItem packages, apps -Recurse -Filter *.test.ts -ErrorAction SilentlyContinue | Measure-Object).Count -gt 0
    if ($hayPruebasTs) { Paso 'TypeScript: node --test' { npm test } } else { Omitido 'TypeScript: node --test' 'todavia no hay pruebas .test.ts' }
    if (Test-Path 'packages\viewer\tsconfig.covillaf3d.json') {
        Paso 'TypeScript: tsc contra COVILLAF 3D (visor e interfaz)' { npx tsc -p packages/viewer/tsconfig.covillaf3d.json --noEmit; if ($LASTEXITCODE -eq 0) { npx tsc -p packages/ui/tsconfig.covillaf3d.json --noEmit } }
        # Solo avisa (como DESIGN): los hermanos cambian a diario; 3 = cambio a revisar, 2 = falta un hermano
        Paso 'Hermanos: huella de lo consumido por alias (aviso)' {
            node packages/viewer/covillaf3d/huella.mjs
            if ($LASTEXITCODE -eq 3) { Write-Host 'AVISO: COVILLAF 3D o DESIGN cambiaron: revisa y ejecuta huella.mjs --actualizar' -ForegroundColor Yellow; $global:LASTEXITCODE = 0 }
        }
    }
}

Write-Host ''
$resultados | Format-Table -AutoSize
if ($resultados | Where-Object { $_.Resultado -like 'FALLA*' }) { exit 1 } else { exit 0 }
