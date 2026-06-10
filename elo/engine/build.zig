const std = @import("std");

// Phase 0 build: the browser engine target (wasm32-freestanding). Memory is
// exported by the module (the allocator owns growth), so JS reads it back via
// instance.exports.memory rather than supplying its own. Later phases add the
// native CLI target (the offline ratings builder) reusing the shared modules.
pub fn build(b: *std.Build) !void {
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    const engine_module = b.createModule(.{
        .root_source_file = b.path("exports.zig"),
        .target = target,
        .optimize = .ReleaseSmall,
    });

    const engine = b.addExecutable(.{
        .name = "engine",
        .root_module = engine_module,
    });

    engine.entry = .disabled; // no _start; this is a library of exports
    engine.rdynamic = true; // keep `export fn`s in the dynamic symbol table

    b.installArtifact(engine);
}
