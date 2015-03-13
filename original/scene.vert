#version 130

// Input vertex data, different for all executions of this shader.
in vec3 vertexPosition_modelspace;
in vec3 vertexNormal;

uniform vec2 loc;

out vec2 UV;
out vec3 fragmentNormal;
out vec2 fragmentPosition;

void main(){

    gl_Position.xyz = (vec3(loc, 0) + vertexPosition_modelspace) * 0.0008;
    gl_Position.w = 1.0;
    
    fragmentPosition = gl_Position.xy;
    UV = (gl_Position.xy + 1) / 2;

    fragmentNormal = vertexNormal;
}
