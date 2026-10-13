"""Análisis modal con el motor propio: K φ = ω² M φ sobre los GDL libres.

Problemas pequeños: forma densa inversa, M φ = μ (K − σM) φ con λ = σ + 1/μ (admite M singular, p. ej. masa
concentrada sin inercia de giro). Problemas grandes: Lanczos implícitamente reiniciado (ARPACK, `eigsh`) en
desplazamiento-inversión con la factorización de K − σM (SuperLU o PARDISO, `lineal.Factorizacion`) como operador.
Las formas se normalizan a φᵀ M φ = 1 y su signo se fija (componente de mayor valor absoluto positiva) para que los
resultados sean deterministas.

Calidad de cada solución (F0-27): error regresivo por modo y **certificado de Sturm**: la inercia de K − σM con σ
justo por encima del último modo (`TOL_STURM`) cuenta los valores propios que hay por debajo; si coincide con los
modos calculados, no se ha saltado ninguno.
"""
from __future__ import annotations

import time

import numpy as np
import scipy.linalg as sla
import scipy.sparse as sp
from scipy.sparse.linalg import LinearOperator, eigsh

from covillaf.sim.modelo import CargaNodal, Modelo, cargas_por_barra
from covillaf.sim.resultados import CertificadoSturm, ResultadosModales
from covillaf.sim.solver.barra import NODOS_GAUSS, PESOS_GAUSS, funciones_forma
from covillaf.sim.solver.ensamblado import (
    Numeracion,
    apoyos,
    cargas_caso,
    ensamblar,
    estabilizar,
    masas_nodales,
    numerar,
    preparar_barras,
)
from covillaf.sim.solver.estatico import NOMBRE_SOLVER, VERSION_SOLVER
from covillaf.sim.solver.lineal import ErrorInestabilidad, Factorizacion, inercia
from covillaf.sim.solver.progreso import Avance, InformeProgreso

#: Pesos nominales de las fases del modal (`progreso`): estimados, no medidos por modelo.
FASES_MODAL = {"barras": 10, "rigidez": 8, "masa": 8, "factorizar": 20, "modos": 30, "calidad": 5, "sturm": 17, "participacion": 2}

#: Por debajo de este número de GDL libres se usa la resolución densa (exacta y completa).
LIMITE_DENSO = 800
#: Separación relativa de σ respecto al último modo en el certificado de Sturm: holgada frente al error de los valores
#: propios calculados (≈ 1e-12); dos modos más próximos que esto se tratan como repetidos.
TOL_STURM = 1e-6
#: Valores propios por debajo de TOL_RIGIDO · traza(K)/traza(M) son modos de sólido rígido (ω = 0 salvo redondeo).
TOL_RIGIDO = 1e-13
#: Error regresivo por modo por encima del cual se avisa (y el análisis no queda certificado).
TOL_RESIDUO_MODAL = 1e-10
#: Semilla del vector inicial del Lanczos: aleatorio (no ortogonal a ningún modo, ni en estructuras simétricas) pero el
#: mismo en cada llamada, para que dos análisis iguales den los mismos bits.
SEMILLA_LANCZOS = 20260924


def certificado_sturm(
    K: sp.spmatrix, M: sp.spmatrix, valores: np.ndarray, *, metodo: str = "auto", intervalo: bool = False, lam_rigido: float = 0.0
) -> CertificadoSturm | None:
    """Comprueba con la inercia de K − σM que no falta ningún valor propio.

    Desde abajo (`intervalo=False`, los primeros modos): ninguno por debajo del mayor calculado. En un intervalo
    (`intervalo=True`, modos alrededor de un desplazamiento): ninguno entre el menor y el mayor calculados. None si
    todos los calculados son de sólido rígido (≤ `lam_rigido`): la cuenta no aplica.
    """
    lam = np.sort(np.asarray(valores, dtype=float))
    if lam.size == 0 or not lam[-1] > max(lam_rigido, 0.0):
        return None
    sigma = lam[-1] * (1.0 + TOL_STURM)
    arriba = inercia((K - sigma * M).tocsc(), metodo=metodo)
    concluyente = arriba.concluyente
    desde, base = None, 0
    if intervalo and lam[0] > max(lam_rigido, 0.0):
        desde = lam[0] * (1.0 - TOL_STURM)
        inferior = inercia((K - desde * M).tocsc(), metodo=metodo)
        base, concluyente = inferior.negativos, concluyente and inferior.concluyente
    dentro = lam > desde if desde is not None else np.ones(lam.size, dtype=bool)
    calculados = int(np.count_nonzero(dentro & (lam < sigma)))
    por_debajo = arriba.negativos - base
    repetidos = 0
    if concluyente and por_debajo > calculados:
        sigma_bajo = lam[-1] * (1.0 - TOL_STURM)
        abajo = inercia((K - sigma_bajo * M).tocsc(), metodo=metodo)
        perdidos = abajo.negativos - base - int(np.count_nonzero(dentro & (lam < sigma_bajo)))
        repetidos = max(por_debajo - calculados - perdidos, 0)
        concluyente = abajo.concluyente
    return CertificadoSturm(sigma, por_debajo, calculados, repetidos, concluyente, arriba.metodo, desde)


def errores_regresivos(K: sp.spmatrix, M: sp.spmatrix, valores: np.ndarray, vectores: np.ndarray) -> np.ndarray:
    """‖Kφ − λMφ‖₁ / ((‖K‖₁ + |λ|·‖M‖₁)·‖φ‖₁) por modo: pequeño (≈ 1e-15) si el par (λ, φ) es solución exacta de
    un problema muy próximo; válido también para los modos de sólido rígido (λ ≈ 0)."""
    norma_k = float(abs(K).sum(axis=0).max())
    norma_m = float(abs(M).sum(axis=0).max())
    r = K @ vectores - (M @ vectores) * valores
    den = (norma_k + np.abs(valores) * norma_m) * np.abs(vectores).sum(axis=0)
    return np.abs(r).sum(axis=0) / np.where(den > 0.0, den, 1.0)


def vectores_influencia(modelo: Modelo, num: Numeracion, punto_ref) -> np.ndarray:
    """Matriz (n, 6): movimiento de sólido rígido unitario en UX, UY, UZ, RX, RY, RZ (giros respecto a punto_ref)."""
    r = np.zeros((num.n, 6))
    p0 = np.asarray(punto_ref, dtype=float)
    for k, nid in enumerate(num.nodos):
        brazo = np.array(modelo.nodos[nid].punto) - p0
        base = 6 * k
        for d in range(3):
            r[base + d, d] = 1.0
            e = np.zeros(3)
            e[d] = 1.0
            r[base : base + 3, 3 + d] = np.cross(e, brazo)
            r[base + 3 + d, 3 + d] = 1.0
    return r


def masa_de_cargas(modelo: Modelo, num: Numeracion, por_id: dict, tipo: str) -> tuple[sp.csr_matrix, list[str]]:
    """Masa traslacional de los casos de la fuente de masa: componente de la carga según la gravedad / g × factor.

    Cargas nodales ⇒ masa en el nodo. Cargas de barra: con masa `consistente`, masa distribuida sobre la barra con las
    mismas funciones de forma que su masa propia (converge igual al refinar); con `concentrada`, en los nodos según
    las fuerzas nodales equivalentes. Las componentes contrarias a la gravedad se ignoran (con aviso).
    """
    n = num.n
    avisos: list[str] = []
    g = np.array(modelo.gravedad, dtype=float)
    g_mod = float(np.linalg.norm(g))
    fuente = modelo.fuente_masa
    if not fuente.casos:
        return sp.csr_matrix((n, n)), avisos
    if g_mod == 0.0:
        return sp.csr_matrix((n, n)), ["aviso fuente-masa: gravedad nula; se ignoran las cargas como masa"]
    direccion = g / g_mod
    diagonal = np.zeros(n)
    filas, columnas, valores = [], [], []
    ignoradas = 0
    for caso, factor in fuente.casos:
        if fuente.elementos and modelo.casos[caso].peso_propio:
            avisos.append(f"aviso fuente-masa [{caso}]: el caso incluye peso propio y la masa propia ya cuenta: doble cuenta")
        if tipo == "concentrada":
            F, _ = cargas_caso(modelo, num, por_id, caso)
            componente = F.reshape(-1, 6)[:, :3] @ direccion * factor / g_mod
            ignoradas += int((componente < 0.0).sum())
            for d in range(3):
                diagonal[d::6] += np.clip(componente, 0.0, None)
            continue
        for c in modelo.cargas:
            if isinstance(c, CargaNodal) and c.caso == caso:
                masa = float(np.array(c.valores[:3]) @ direccion) * factor / g_mod
                ignoradas += masa < 0.0
                diagonal[num.gdl(c.nodo)[:3]] += max(masa, 0.0)
        for bid, cb in cargas_por_barra(modelo, caso).items():
            e = por_id[bid]
            g_local = e.R @ direccion
            m_local = np.zeros((12, 12))
            for t in cb.tramos:
                h = t.b - t.a
                if h <= 0.0:
                    continue
                s = t.a + h * NODOS_GAUSS
                masa = factor * (t.q(s) @ g_local) / g_mod
                ignoradas += int((masa < 0.0).any())
                N = funciones_forma(s, e.largo, 0.0, 0.0)
                m_local += h * np.einsum("g,gki,gkj->ij", PESOS_GAUSS * np.clip(masa, 0.0, None), N, N)
            for p in cb.puntuales:
                masa = factor * float(p.P @ g_local) / g_mod
                ignoradas += masa < 0.0
                N = funciones_forma(p.a, e.largo, 0.0, 0.0)[0]
                m_local += max(masa, 0.0) * (N.T @ N)
            B = e.C @ e.TO
            filas.append(np.repeat(e.gdl, 12))
            columnas.append(np.tile(e.gdl, 12))
            valores.append((B.T @ m_local @ B).ravel())
    if ignoradas:
        avisos.append(f"aviso fuente-masa: {ignoradas} cargas con componente contraria a la gravedad (se ignoran)")
    M = sp.diags(diagonal).tocsr()
    if valores:
        extra = sp.coo_matrix((np.concatenate(valores), (np.concatenate(filas), np.concatenate(columnas))), shape=(n, n))
        M = M + ((extra + extra.T) * 0.5).tocsr()
    return M.tocsr(), avisos


def _problema_modal(
    modelo: Modelo, masa: str, deformacion_cortante: bool, avance: Avance | None = None
) -> tuple[Numeracion, np.ndarray, sp.csc_matrix, sp.csc_matrix, list[str]]:
    """(numeración, GDL libres, K y M sobre los GDL libres, avisos): K con resortes y estabilización; M con la masa
    propia, las masas nodales y la de las cargas de la fuente de masa."""
    avance = avance or Avance(None, FASES_MODAL)
    avance.fase("barras", "preparar las barras")
    avisos = [str(p) for p in modelo.comprobar()]
    num = numerar(modelo)
    n = num.n
    elementos = preparar_barras(modelo, num, deformacion_cortante, avance)
    por_id = {e.id: e for e in elementos}
    avance.fase("rigidez", "ensamblar la rigidez")
    K = ensamblar(elementos, n, lambda e: e.rigidez_global(), avance)
    restringido, resortes = apoyos(modelo, num)
    K = (K + sp.diags(resortes)).tocsr()

    avance.fase("masa", f"ensamblar la masa ({masa})")
    fuente = modelo.fuente_masa
    M = ensamblar(elementos, n, lambda e: e.masa_global(masa), avance) if fuente.elementos else sp.csr_matrix((n, n))
    diagonal_extra = masas_nodales(modelo, num) if fuente.masas_nodales else np.zeros(n)
    m_cargas, av = masa_de_cargas(modelo, num, por_id, masa)
    avisos += av
    M = (M + sp.diags(diagonal_extra) + m_cargas).tocsr()

    libres = np.flatnonzero(~restringido)
    if libres.size == 0:
        raise ValueError("el modelo no tiene GDL libres: no hay modos que calcular")
    Kff = K[libres][:, libres]
    Mff = M[libres][:, libres].tocsc()
    est = estabilizar(Kff, libres, num)
    avisos += est.avisos
    return num, libres, (Kff + est.matriz).tocsc(), Mff, avisos


def modos_por_debajo(
    modelo: Modelo, frecuencia: float, *, masa: str = "consistente", deformacion_cortante: bool = True, metodo: str = "auto"
) -> int:
    """Número de modos con frecuencia menor que `frecuencia` (Hz), sin calcularlos: inercia de K − (2πf)²M.

    Sirve para saber cuántos modos pedir (p. ej. todos los de menos de 33 Hz). Error si σ casi coincide con un valor
    propio (pivotes perturbados): basta mover `frecuencia` una fracción.
    """
    frecuencia = float(frecuencia)
    if not (np.isfinite(frecuencia) and frecuencia >= 0.0):
        raise ValueError(f"frecuencia {frecuencia} Hz: debe ser un número finito ≥ 0")
    _, _, Kff, Mff, _ = _problema_modal(modelo, masa, deformacion_cortante)
    sigma = (2.0 * np.pi * frecuencia) ** 2
    resultado = inercia((Kff - sigma * Mff).tocsc(), metodo=metodo)
    if not resultado.concluyente:
        raise ValueError(f"recuento no concluyente a {frecuencia} Hz: la frecuencia casi coincide con la de un modo")
    return resultado.negativos


def analizar_modal(
    modelo: Modelo,
    n_modos: int = 12,
    *,
    masa: str = "consistente",
    desplazamiento: float | None = None,
    punto_ref=(0.0, 0.0, 0.0),
    deformacion_cortante: bool = True,
    resolvedor: str | None = None,
    sturm: bool = True,
    progreso: InformeProgreso | None = None,
) -> ResultadosModales:
    """Frecuencias, formas normalizadas a masa unidad y masas participativas de `n_modos` modos.

    `desplazamiento`: None (o σ ≤ 0) ⇒ los **primeros** modos; σ > 0 (rad²/s²) ⇒ los modos **más próximos a σ**
    (centro del espectro buscado, como la opción de desplazamiento de frecuencia de los programas de referencia).
    `resolvedor`: «auto», «superlu» o «pardiso» para K − σM (None: el del contexto, `lineal.usar_resolvedor`).
    `sturm`: certificado de que no falta ningún modo (una factorización LDLᵀ más; casi siempre, una sola).
    Caminos: denso (≤ `LIMITE_DENSO` GDL libres), reducción exacta a los GDL con masa si son pocos (los GDL sin masa
    no tienen inercia: su condensación estática es exacta) o Lanczos.
    `progreso`: ``progreso(fraccion, texto)`` al empezar cada fase, dentro de los bucles y en cada producto del
    Lanczos; si lanza, el análisis se interrumpe y la excepción sale tal cual (cancelación, `covillaf.sim.solver.progreso`).
    """
    inicio = time.perf_counter()
    avance = Avance(progreso, FASES_MODAL)
    num, libres, Kff, Mff, avisos = _problema_modal(modelo, masa, deformacion_cortante, avance)
    abiertas: list[Factorizacion] = []

    def factorizar(A: sp.spmatrix, **opciones) -> Factorizacion:
        """`Factorizacion` que se libera al salir (también si `progreso` cancela: el factor de PARDISO no espera al
        recolector)."""
        f = Factorizacion(A, resolvedor=resolvedor, **opciones)
        abiertas.append(f)
        return f

    try:
        n = num.n
        nf = libres.size

        masivos = np.flatnonzero(np.asarray(abs(Mff).sum(axis=1)).ravel() != 0.0)
        con_masa = int(masivos.size)
        if con_masa == 0:
            raise ValueError("el modelo no tiene masa en ningún GDL libre (fuente de masa vacía o densidades nulas)")
        pedidos = n_modos
        n_modos = min(n_modos, con_masa)
        escala_lam = float(Kff.diagonal().sum() / Mff.diagonal().sum())

        centrado = desplazamiento is not None and float(desplazamiento) > 0.0
        sigma = 0.0 if desplazamiento is None else float(desplazamiento)
        avance.fase("factorizar", f"factorizar K − σM ({nf} GDL libres)")
        try:
            fact = factorizar(Kff - sigma * Mff, definida=not centrado)
        except ErrorInestabilidad:
            if desplazamiento is not None:
                raise
            sigma = -1e-6 * escala_lam
            avance.pulso()
            fact = factorizar(Kff - sigma * Mff)
            avisos.append(f"aviso cuerpo-libre: K singular (modos de sólido rígido); desplazamiento σ = {sigma:.3e} rad²/s²")
        for intento in range(3):  # σ casi valor propio: PARDISO perturba pivotes y la solución pierde precisión sin error
            if not fact.pivotes_perturbados:
                break
            nuevo = sigma * (1.0 + 1e-4 * 10**intento)
            avisos.append(f"aviso desplazamiento: σ = {sigma:.6e} rad²/s² casi coincide con un valor propio; se mueve a {nuevo:.6e}")
            sigma = nuevo
            fact.liberar()
            avance.pulso()
            fact = factorizar(Kff - sigma * Mff, definida=False)

        # Desplazamiento definido para los caminos densos (eigh exige K − σ_d M definida positiva).
        sigma_d = sigma
        if centrado:
            try:
                avance.pulso()
                factorizar(Kff).liberar()
                sigma_d = 0.0
            except ErrorInestabilidad:
                sigma_d = -1e-6 * escala_lam

        def elegir(mu: np.ndarray, vec: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
            validos = mu > 1e-12 * max(float(mu.max()), 1e-300)
            lam, vec = sigma_d + 1.0 / mu[validos], vec[:, validos]
            orden = np.argsort(np.abs(lam - sigma)) if centrado else np.argsort(lam)
            return lam[orden[:n_modos]], vec[:, orden[:n_modos]]

        if nf <= LIMITE_DENSO or n_modos >= nf - 1:
            avance.fase("modos", "extraer los modos (denso)")
            lam, vec = elegir(*sla.eigh(Mff.toarray(), (Kff - sigma_d * Mff).toarray()))
            metodo, usado = "denso (eigh)", "LAPACK (denso)"
        elif con_masa <= LIMITE_DENSO:
            avance.fase("modos", f"extraer los modos (reducción a {con_masa} GDL con masa)")
            sin_masa = np.setdiff1d(np.arange(nf), masivos)
            A = (Kff - sigma_d * Mff).tocsc()
            fs = factorizar(A[sin_masa][:, sin_masa])
            A_sm = A[sin_masa][:, masivos].toarray()
            X = fs.resolver(A_sm)
            fs.liberar()
            avance.pulso()
            C = A[masivos][:, masivos].toarray() - A_sm.T @ X
            lam_m, vec_m = elegir(*sla.eigh(Mff[masivos][:, masivos].toarray(), 0.5 * (C + C.T)))
            vec = np.zeros((nf, lam_m.size))
            vec[masivos], vec[sin_masa] = vec_m, -X @ vec_m
            lam = lam_m
            metodo, usado = f"reducción exacta a los {con_masa} GDL con masa + denso (eigh)", fs.resolvedor
        else:
            avance.fase("modos", f"extraer {n_modos} modos (Lanczos)")

            def producto(x: np.ndarray) -> np.ndarray:
                avance.pulso()  # punto de cancelación en cada iteración del Lanczos
                return fact.resolver(x)

            op = LinearOperator((nf, nf), matvec=producto, dtype=float)
            # Vector inicial fijo (sin él ARPACK sortea uno distinto en cada llamada y el resultado varía ≈ 1e-14).
            inicial = np.random.default_rng(SEMILLA_LANCZOS).standard_normal(nf)
            lam, vec = eigsh(Kff, k=n_modos, M=Mff, sigma=sigma, which="LM", OPinv=op, v0=inicial)
            metodo, usado = "Lanczos (ARPACK, desplazamiento-inversión)", fact.resolvedor
        fact.liberar()
        orden = np.argsort(lam)
        lam, vec = lam[orden], vec[:, orden]
        if lam.size < pedidos:
            avisos.append(f"aviso modos: se piden {pedidos} y el modelo solo admite {lam.size} con masa")

        # Normalización a masa unidad y signo determinista.
        avance.fase("calidad", "normalizar los modos y medir su error regresivo")
        mm = np.einsum("ij,ij->j", vec, Mff @ vec)
        vec = vec / np.sqrt(mm)
        fila = np.argmax(np.abs(vec), axis=0)
        vec = vec * np.sign(vec[fila, np.arange(vec.shape[1])])
        negativos = lam < 0.0
        if negativos.any():
            avisos.append(f"aviso modos: {int(negativos.sum())} valores propios negativos por redondeo (ω = 0)")
        residuos = errores_regresivos(Kff, Mff, lam, vec)
        if residuos.size and residuos.max() > TOL_RESIDUO_MODAL:
            avisos.append(f"aviso modos: error regresivo máximo {residuos.max():.1e} > {TOL_RESIDUO_MODAL:.0e} (modo "
                          f"{int(np.argmax(residuos)) + 1}): resultado no certificado")
        metodo_inercia = resolvedor if resolvedor in ("superlu", "pardiso") else "auto"
        if sturm:
            avance.fase("sturm", "certificado de Sturm (contar los modos por debajo)")
        certificado = (certificado_sturm(Kff, Mff, lam, metodo=metodo_inercia, intervalo=centrado, lam_rigido=TOL_RIGIDO * escala_lam)
                       if sturm else None)
        donde = "por debajo de" if certificado is None or certificado.desde is None else f"entre {certificado.desde:.6e} y"
        if certificado is not None and not certificado.valido:
            if not certificado.concluyente:
                avisos.append(f"aviso sturm: recuento no concluyente en σ = {certificado.desplazamiento:.6e} rad²/s² "
                              "(pivotes perturbados o fuera de la diagonal)")
            elif certificado.perdidos > 0:
                avisos.append(f"error sturm: faltan {certificado.perdidos} modos {donde} σ = "
                              f"{certificado.desplazamiento:.6e} rad²/s² ({certificado.por_debajo} en el problema, "
                              f"{certificado.calculados} calculados)")
            else:
                avisos.append(f"error sturm: {-certificado.perdidos} modos calculados de más {donde} σ = "
                              f"{certificado.desplazamiento:.6e} rad²/s² (espurios)")
        if certificado is not None and certificado.repetidos_cortados:
            avisos.append(f"aviso sturm: el último modo es múltiple; quedan {certificado.repetidos_cortados} modos iguales "
                          "sin calcular (pide más modos)")

        avance.fase("participacion", "masas participativas")
        r = vectores_influencia(modelo, num, punto_ref)[libres]
        Mr = Mff @ r
        gamma = vec.T @ Mr
        masa_total = np.einsum("ij,ij->j", r, Mr)

        formas = np.zeros((lam.size, n))
        formas[:, libres] = vec.T
        avance.fin("cálculo modal terminado")
        return ResultadosModales(
            nodos=num.nodos,
            valores_propios=lam,
            formas=formas.reshape(lam.size, -1, 6),
            factores_participacion=gamma,
            masa_total=masa_total,
            tipo_masa=masa,
            punto_ref=tuple(float(c) for c in punto_ref),
            avisos=tuple(avisos),
            metadatos={
                "solver": NOMBRE_SOLVER,
                "version": VERSION_SOLVER,
                "analisis": "modal",
                "metodo": metodo,
                "resolvedor": usado,
                "gdl": n,
                "gdl_libres": int(nf),
                "desplazamiento": sigma,
                "modos": "alrededor de σ" if centrado else "primeros",
                "tol_residuo": TOL_RESIDUO_MODAL,
                "deformacion_cortante": deformacion_cortante,
                "segundos": time.perf_counter() - inicio,
            },
            residuos=residuos,
            sturm=certificado,
        )
    finally:
        for f in abiertas:
            f.liberar()
