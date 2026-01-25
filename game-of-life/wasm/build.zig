const std = @import("std");

const wasm_initial_memory = 32 * std.wasm.page_size;
const wasm_max_memory = wasm_initial_memory;

pub fn build(b: *std.Build) !void {
    const target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    const exe = b.addExecutable(.{
        .name = "GameOfLife",
        .root_source_file = b.path("main.zig"),
        .target = target,
        .optimize = .ReleaseSmall,
    });

    exe.entry = .disabled;
    exe.rdynamic = true;
    exe.import_memory = true;
    exe.import_symbols = true;

    const exe_options = b.addOptions();
    exe_options.addOption(usize, "memory_size", wasm_max_memory);
    exe.root_module.addOptions("build_options", exe_options);
    b.installArtifact(exe);
}
