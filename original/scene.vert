#version 130

// Input vertex data, different for all executions of this shader.
in vec3 vertexPosition_modelspace;

uniform vec2 loc;

out vec2 fragPos;
out vec2 UV;

void main(){

    gl_Position.xyz = (vec3(loc, 0) + vertexPosition_modelspace) * 0.0008;
    gl_Position.w = 1.0;
    
    fragPos = gl_Position.xy;
    UV = (gl_Position.xy + 1) / 2;
}
