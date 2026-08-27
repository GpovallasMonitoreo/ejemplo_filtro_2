import * as THREE from 'https://cdn.skypack.dev/three@0.136.0/build/three.module.js';

const vertexShader = `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = `
  uniform sampler2D tDiffuse;
  uniform vec2 resolution;
  uniform vec2 faceCenter;
  uniform float faceRadius;
  varying vec2 vUv;

  float gaussian(float x, float sigma) {
    return exp(-(x * x) / (2.0 * sigma * sigma));
  }

  void main() {
    vec4 originalColor = texture2D(tDiffuse, vUv);
    
    // 1. LÍNEA DIVISORIA
    if (abs(vUv.x - 0.5) < (1.5 / resolution.x)) {
        gl_FragColor = vec4(1.0, 1.0, 1.0, 0.8); 
        return;
    }

    // 2. MITAD IZQUIERDA: PIEL ACTUAL
    if (vUv.x > 0.5) { 
        vec3 oldColor = originalColor.rgb;
        float luminance = dot(oldColor, vec3(0.299, 0.587, 0.114));
        oldColor = mix(vec3(luminance), oldColor, 0.80); 
        oldColor = mix(vec3(0.5), oldColor, 1.18); 
        gl_FragColor = vec4(oldColor, 1.0);
        return;
    }

    // 3. MITAD DERECHA: FILTRO EUCERIN
    if (faceCenter.x < 0.0) {
        gl_FragColor = originalColor;
        return;
    }

    vec2 aspect = vec2(resolution.x / resolution.y, 1.0);
    float dist = distance(vUv * aspect, faceCenter * aspect);
    float actualRadius = faceRadius * aspect.x * 1.5; 
    
    float mask = 1.0 - smoothstep(actualRadius * 0.4, actualRadius * 1.2, dist);

    if (mask <= 0.01) {
        gl_FragColor = originalColor;
        return;
    }

    vec3 blurredColor = vec3(0.0);
    float totalWeight = 0.0;
    float spatialSigma = 5.0;  
    float colorSigma = 0.22;   
    vec2 texelSize = 1.0 / resolution;

    for(int i = -3; i <= 3; i++) {
        for(int j = -3; j <= 3; j++) {
            vec2 offset = vec2(float(i), float(j)) * texelSize * 2.5; 
            vec4 sampleColor = texture2D(tDiffuse, vUv + offset);
            float spatialDist = length(vec2(float(i), float(j)));
            float spatialWeight = gaussian(spatialDist, spatialSigma);
            float colorDist = distance(originalColor.rgb, sampleColor.rgb);
            float colorWeight = gaussian(colorDist, colorSigma);
            float weight = spatialWeight * colorWeight;
            blurredColor += sampleColor.rgb * weight;
            totalWeight += weight;
        }
    }
    blurredColor /= totalWeight;

    vec3 beautyColor = mix(originalColor.rgb, blurredColor, 0.92);
    beautyColor = beautyColor * 1.10; 
    beautyColor.r *= 1.05; 
    beautyColor.g *= 0.98; 
    
    vec3 finalOutput = mix(originalColor.rgb, beautyColor, mask);
    gl_FragColor = vec4(finalOutput, 1.0);
  }
`;

document.addEventListener('DOMContentLoaded', async () => {
    const video = document.getElementById('video_feed');
    const canvas = document.getElementById('output_canvas');
    
    const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, preserveDrawingBuffer: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    camera.position.z = 1;

    const videoTexture = new THREE.VideoTexture(video);
    videoTexture.minFilter = THREE.LinearFilter;
    videoTexture.magFilter = THREE.LinearFilter;

    const uniforms = {
        tDiffuse: { value: videoTexture },
        resolution: { value: new THREE.Vector2(1080, 1920) }, // Default móvil
        faceCenter: { value: new THREE.Vector2(-1.0, -1.0) },
        faceRadius: { value: 0.3 }
    };

    const shaderMaterial = new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms });
    const planeMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), shaderMaterial);
    scene.add(planeMesh);

    let videoIsReady = false;

    // --- 1. CONEXIÓN DIRECTA A LA CÁMARA (Sin intermediarios) ---
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                facingMode: 'user',
                width: { ideal: 1920 }, // Pide máxima calidad
                height: { ideal: 1920 } // El celular decidirá su mejor proporción nativa
            },
            audio: false
        });
        video.srcObject = stream;
        video.play();
    } catch (err) {
        console.error("Error de cámara:", err);
        alert("Por favor permite el acceso a la cámara para ver la experiencia.");
    }

    // --- 2. EL AJUSTE PERFECTO ---
    video.addEventListener('loadeddata', () => {
        const vw = video.videoWidth;
        const vh = video.videoHeight;
        
        // Seteamos la resolución exacta del hardware de la cámara
        renderer.setSize(vw, vh, false); 
        shaderMaterial.uniforms.resolution.value.set(vw, vh);
        videoIsReady = true;
        
        // Encendemos la Inteligencia Artificial
        processAI();
    });

    // --- 3. BUCLE DE RENDERIZADO VISUAL (Corre a 60FPS) ---
    function renderLoop() {
        requestAnimationFrame(renderLoop);
        if (videoIsReady && video.readyState >= 2) {
            videoTexture.needsUpdate = true;
            renderer.render(scene, camera);
        }
    }
    renderLoop();

    // --- 4. CONFIGURACIÓN DE IA MEDIAPIPE ---
    const faceMesh = new FaceMesh({
        locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
    });
    faceMesh.setOptions({ maxNumFaces: 1, refineLandmarks: false });

    faceMesh.onResults((results) => {
        if (results.multiFaceLandmarks && results.multiFaceLandmarks.length > 0) {
            const landmarks = results.multiFaceLandmarks[0];
            const nose = landmarks[4];
            const leftCheek = landmarks[234];
            const rightCheek = landmarks[454];
            
            // Distancia absoluta para el radio
            const faceWidth = Math.abs(rightCheek.x - leftCheek.x);
            
            shaderMaterial.uniforms.faceCenter.value.set(1.0 - nose.x, 1.0 - nose.y);
            shaderMaterial.uniforms.faceRadius.value = faceWidth; 
        } else {
            shaderMaterial.uniforms.faceCenter.value.set(-1.0, -1.0);
        }
    });

    // --- 5. BUCLE DE INTELIGENCIA ARTIFICIAL (Independiente) ---
    async function processAI() {
        if (videoIsReady && video.readyState >= 2) {
            await faceMesh.send({ image: video });
        }
        // Se llama a sí mismo en el siguiente frame sin trabar el render
        requestAnimationFrame(processAI); 
    }

    // Evento Landing Page
    document.getElementById('buy_btn').addEventListener('click', () => {
        window.location.href = "https://eucerin.com.mx/productos/hyaluron-filler";
    });
});
