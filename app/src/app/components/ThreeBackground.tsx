"use client";

import { useRef, useMemo, useEffect, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const Particles = ({ isMobile }: { isMobile: boolean }) => {
  const ref = useRef<THREE.Points>(null!);
  const mouse = useRef({ x: 0, y: 0 });
  const enableParallax = !isMobile;

  const { camera } = useThree();

  useEffect(() => {
    if (!enableParallax) return;
    const handler = (e: MouseEvent) => {
      mouse.current.x = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.current.y = -(e.clientY / window.innerHeight - 0.5) * 2;
    };
    window.addEventListener("mousemove", handler);
    return () => window.removeEventListener("mousemove", handler);
  }, [enableParallax]);

  const { positions, colors } = useMemo(() => {
    const count = isMobile ? 150 : 600;
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    const palette = [
      [1, 0.27, 0], // #ff4500
      [1, 0.4, 0.2],
      [0.85, 0.2, 0],
      [1, 0.7, 0.3], // Amberish
      [0.8, 0.8, 0.8], // Whiteish
    ];
    for (let i = 0; i < count; i++) {
      pos[i * 3] = (Math.random() - 0.5) * 160;
      pos[i * 3 + 1] = (Math.random() - 0.5) * 100;
      pos[i * 3 + 2] = (Math.random() - 0.5) * 80;
      const c = palette[Math.floor(Math.random() * palette.length)];
      col[i * 3] = c[0];
      col[i * 3 + 1] = c[1];
      col[i * 3 + 2] = c[2];
    }
    return { positions: pos, colors: col };
  }, [isMobile]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (ref.current) {
      ref.current.rotation.y = t * 0.06;
      ref.current.rotation.x = t * 0.03;
    }
    if (enableParallax) {
      camera.position.x += (mouse.current.x * 8 - camera.position.x) * 0.04;
      camera.position.y += (mouse.current.y * 5 - camera.position.y) * 0.04;
    }
    camera.lookAt(0, 0, 0);
  });

  return (
    <points ref={ref}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.5} vertexColors transparent opacity={0.3} sizeAttenuation />
    </points>
  );
};

const WireframeIcosa = () => {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    ref.current.rotation.x = t * 0.12;
    ref.current.rotation.y = t * 0.2;
  });
  return (
    <mesh ref={ref} position={[55, 10, -30]}>
      <icosahedronGeometry args={[14, 1]} />
      <meshBasicMaterial color="#ff4500" wireframe transparent opacity={0.04} />
    </mesh>
  );
};

const WireframeTorus = () => {
  const ref = useRef<THREE.Mesh>(null!);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    ref.current.rotation.x = t * 0.25;
    ref.current.rotation.y = t * 0.15;
  });
  return (
    <mesh ref={ref} position={[-45, -15, -10]}>
      <torusGeometry args={[22, 6, 8, 28]} />
      <meshBasicMaterial color="#ff6534" wireframe transparent opacity={0.03} />
    </mesh>
  );
};

export function ThreeBackground() {
  const [isMobile, setIsMobile] = useState(false);

  useEffect(() => {
    const checkViewport = () => setIsMobile(window.innerWidth < 768);
    checkViewport();
    window.addEventListener("resize", checkViewport);
    return () => window.removeEventListener("resize", checkViewport);
  }, []);

  return (
    <div className="fixed inset-0 z-0 pointer-events-none">
      <Canvas camera={{ position: [0, 0, 60], fov: 60 }} gl={{ alpha: true, antialias: false }} dpr={1}>
        <Particles isMobile={isMobile} />
        <WireframeIcosa />
        <WireframeTorus />
      </Canvas>
    </div>
  );
}
